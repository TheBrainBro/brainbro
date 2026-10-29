import '@xyflow/react/dist/style.css'

import { useQueryClient } from '@tanstack/react-query'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  type DragEvent,
} from 'react'

import { useCapturePipeline } from '../capture/context'
import type { CaptureInput, CaptureInputs } from '../capture/inputs'
import { itemKey, itemsKey, type Item } from '../items/api'
import { isEditable } from '../lib/dom'
import { whenReachable } from '../lib/network'
import { useSaveOnLeave } from '../lib/useSaveOnLeave'
import { AddItemsPanel } from './AddItemsPanel'
import { boardKey, boardsKey, saveLayout, seedItems, type Board } from './api'
import { BoardContext } from './context'
import { ItemNode } from './ItemNode'
import { ItemPanel } from './ItemPanel'
import {
  DEFAULT_WIDTH,
  dropSpot,
  dropSpots,
  freeSpot,
  ITEM_DRAG_TYPE,
  newNodeId,
  toFlowNodes,
  type ItemFlowNode,
} from './layout'
import { PendingDrops, type Drop } from './PendingDrops'
import { layoutDrafts, type LayoutSaverState } from './saver'
import { BoardSession } from './session'

// Outside the component: React Flow remounts every node if this changes.
const nodeTypes = { item: ItemNode }

// Zoom to fit never blows a few cards up past their real size.
const fitViewOptions = { maxZoom: 1 }

const toolButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800'

/** The end of a gesture: a drag dropped, a resize let go, nodes deleted. */
function isCommit(change: NodeChange<ItemFlowNode>) {
  return (
    change.type === 'remove' ||
    (change.type === 'position' && change.dragging === false) ||
    (change.type === 'dimensions' && change.resizing === false)
  )
}

/** The width a card will likely get, before its item exists (the server may infer another kind). */
function widthFor(input: CaptureInput | undefined) {
  if (input?.kind === 'url') return DEFAULT_WIDTH.link
  if (input?.kind !== 'file') return DEFAULT_WIDTH.note
  return input.file.type.startsWith('image/') ? DEFAULT_WIDTH.image : DEFAULT_WIDTH.file
}

/** The item an Add items row carries when dragged, if this drag is one. */
function draggedItem(event: DragEvent): Item | undefined {
  const raw = event.dataTransfer.getData(ITEM_DRAG_TYPE)
  if (!raw) return undefined
  try {
    const item = JSON.parse(raw) as Item
    return typeof item?.id === 'string' && item.kind in DEFAULT_WIDTH ? item : undefined
  } catch {
    return undefined
  }
}

/**
 * The canvas of one board. The layout it starts from is read once (remount
 * with `key` to load another); from then on the canvas owns it and saves
 * every committed change, with undo and redo over those changes. While it
 * is open and editable, pastes and drops land on it, through the capture
 * pipeline.
 */
export function BoardCanvas({ board, readOnly }: { board: Board; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const flow = useReactFlow<ItemFlowNode>()
  const container = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const pipeline = useCapturePipeline()
  const [, historyChanged] = useReducer((count: number) => count + 1, 0)
  // The right-hand panel: adding items, or one item shown whole.
  const [panel, setPanel] = useState<{ adding: true } | { itemId: string } | null>(null)
  // Null until the saver first reports: it may start from a restored draft.
  const [reported, setSaveState] = useState<LayoutSaverState | null>(null)

  const [session] = useState(
    () =>
      new BoardSession(board, {
        save: (layout, revision, options) => saveLayout(board.id, layout, revision, options),
        onSaveState: setSaveState,
        drafts: layoutDrafts,
        onSaved: (saved, placed) => {
          // Coming back to the board starts from what was saved, not what was loaded.
          queryClient.setQueryData<Board>(
            boardKey(board.id),
            (cached) => cached && { ...cached, revision: saved.revision, layout: saved.layout },
          )
          queryClient.invalidateQueries({ queryKey: boardsKey, exact: true })
          // Placing an inbox item organizes it: lists showing it are out of date.
          if (placed) {
            queryClient.invalidateQueries({
              queryKey: itemsKey,
              predicate: (query) => query.queryKey[1] !== 'detail',
            })
          }
        },
      }),
  )
  const { history, saver } = session
  const saveState = reported ?? saver.snapshot
  const [nodes, setNodes] = useState(() => session.initialNodes)
  // Changes and commits arrive in the same tick: commits read this, not state.
  const latest = useRef(nodes)

  useEffect(() => session.resume(), [session])
  useSaveOnLeave(saver)

  // What is being captured onto the board, until its item exists. Callbacks
  // read the ref, render the state (as with nodes).
  const [drops, setDrops] = useState<Drop[]>([])
  const latestDrops = useRef(drops)
  function showDrops(next: Drop[]) {
    latestDrops.current = next
    setDrops(next)
  }
  // Where the pointer last was over the canvas: where a paste lands.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  // Captures that finish after the board is closed stay in the inbox.
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])

  function show(next: ItemFlowNode[]) {
    latest.current = next
    setNodes(next)
  }

  function commit() {
    if (!readOnly && session.commit(latest.current, flow.getViewport())) historyChanged()
  }

  function onNodesChange(changes: NodeChange<ItemFlowNode>[]) {
    show(applyNodeChanges(changes, latest.current))
    if (changes.some(isCommit)) commit()
  }

  function travel(direction: 'undo' | 'redo') {
    const next = session.travel(direction, flow.getViewport())
    if (!next) return
    show(next)
    historyChanged()
  }

  /** Puts an item on the board at `position` (if it isn't there already) and commits. */
  function place(item: Item, position: { x: number; y: number }, select: boolean) {
    if (latest.current.some((node) => node.data.itemId === item.id)) return
    queryClient.setQueryData(itemKey(item.id), item)
    session.place()
    const others = select
      ? latest.current.map((node) => (node.selected ? { ...node, selected: false } : node))
      : latest.current
    show([
      ...others,
      {
        id: newNodeId(),
        type: 'item',
        position,
        width: DEFAULT_WIDTH[item.kind],
        data: { itemId: item.id },
        selected: select,
      },
    ])
    commit()
  }

  /** Where a paste lands: under the pointer if it is over the canvas, else near the middle. */
  function pastePoint() {
    if (pointer.current) return flow.screenToFlowPosition(pointer.current)
    const box = container.current!.getBoundingClientRect()
    return flow.screenToFlowPosition({
      x: box.left + box.width / 2,
      y: box.top + box.height / 3,
    })
  }

  function add(item: Item) {
    place(item, freeSpot(pastePoint(), DEFAULT_WIDTH[item.kind], latest.current), true)
  }

  /** A paste or a drop: captured like anywhere else, each card placed once its item exists. */
  function captureHere(found: CaptureInputs, at: { x: number; y: number } | null) {
    const point = at ? flow.screenToFlowPosition(at) : pastePoint()
    pipeline.capture(found, {
      // Taking a card off the board is the undo here (⌘Z); the item stays.
      undo: false,
      onQueued: (ids) => {
        const widths = ids.map((_, index) => widthFor(found.inputs[index]))
        const spots = dropSpots(point, widths, [...latest.current, ...latestDrops.current])
        const added = ids.map((id, index) => ({ id, position: spots[index], width: widths[index] }))
        showDrops([...latestDrops.current, ...added])
      },
      onSettled: (result) => {
        const drop = latestDrops.current.find((candidate) => candidate.id === result.id)
        if (!drop || !('item' in result) || !open.current) return
        showDrops(latestDrops.current.filter((candidate) => candidate !== drop))
        place(result.item, drop.position, false)
      },
    })
  }

  const onCapture = useEffectEvent(captureHere)
  const registerTarget = pipeline.target
  useEffect(() => {
    if (readOnly) return
    return registerTarget({
      contains: (node) => Boolean(pane.current?.contains(node)),
      capture: (found, at) => onCapture(found, at),
    })
  }, [readOnly, registerTarget])

  // Dismissed: the pipeline forgot it, so does the board.
  const visibleDrops = drops.filter((drop) =>
    pipeline.pending.some((entry) => entry.id === drop.id),
  )
  const forgotten = visibleDrops.length !== drops.length
  useEffect(() => {
    if (!forgotten) return
    showDrops(
      latestDrops.current.filter((drop) =>
        pipeline.pending.some((entry) => entry.id === drop.id),
      ),
    )
  }, [forgotten, pipeline.pending])

  // Failed for lack of network: try again as soon as it may be back.
  const retryDrops = useEffectEvent(() => {
    for (const entry of pipeline.pending) {
      const ours = latestDrops.current.some((drop) => drop.id === entry.id)
      if (ours && entry.state === 'error' && entry.retryable) pipeline.retry(entry.id)
    }
  })
  useEffect(() => whenReachable(retryDrops), [])

  // What is still being captured is lost with the page.
  const capturing = visibleDrops.length > 0
  useEffect(() => {
    if (!capturing) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [capturing])

  function onDragOver(event: DragEvent) {
    if (readOnly || !event.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(event: DragEvent) {
    if (readOnly) return
    const item = draggedItem(event)
    if (!item) return
    event.preventDefault()
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    place(item, dropSpot(point, DEFAULT_WIDTH[item.kind], latest.current), true)
  }

  function resolveConflict(side: 'mine' | 'theirs') {
    const theirs = session.resolve(side)
    if (!theirs) return
    seedItems(queryClient, theirs.items)
    queryClient.setQueryData(boardKey(board.id), theirs)
    historyChanged()
    show(toFlowNodes(theirs.layout))
  }

  const shortcut = useEffectEvent((direction: 'undo' | 'redo') => travel(direction))
  useEffect(() => {
    if (readOnly) return
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || isEditable(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' || key === 'y') {
        event.preventDefault()
        shortcut(key === 'y' || event.shiftKey ? 'redo' : 'undo')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readOnly])

  const onBoard = useMemo(() => new Set(nodes.map((node) => node.data.itemId)), [nodes])
  // Stable, so cards don't re-render when the canvas does.
  const actions = useMemo(() => {
    function setEditing(nodeId: string | null) {
      if (!nodeId && !latest.current.some((node) => node.data.editing)) return
      const next = latest.current.map((node) =>
        Boolean(node.data.editing) === (node.id === nodeId)
          ? node
          : { ...node, data: { ...node.data, editing: node.id === nodeId } },
      )
      latest.current = next
      setNodes(next)
    }
    return {
      readOnly,
      openItem: (itemId: string) => setPanel({ itemId }),
      startEditing: (nodeId: string) => setEditing(nodeId),
      stopEditing: () => setEditing(null),
    }
  }, [readOnly])

  function removeItem(itemId: string) {
    const node = latest.current.find((candidate) => candidate.data.itemId === itemId)
    if (node) flow.deleteElements({ nodes: [{ id: node.id }] })
    setPanel(null)
  }

  return (
    <BoardContext value={actions}>
      <div
        ref={container}
        className="relative h-full min-h-0"
        onPointerMove={(event) => {
          pointer.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerLeave={() => {
          pointer.current = null
        }}
      >
        <ReactFlow
          ref={pane}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodes={nodes}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          defaultViewport={board.layout.viewport}
          // A phone shows the whole board; a desktop comes back where it was.
          fitView={readOnly}
          minZoom={0.05}
          maxZoom={4}
          onlyRenderVisibleElements
          colorMode="system"
          nodesDraggable={!readOnly}
          nodesConnectable={false}
          elementsSelectable={!readOnly}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitViewOptions={fitViewOptions}
          // On a phone a tap opens the item; on a desktop a click selects.
          onNodeClick={(_, node) => {
            if (readOnly) actions.openItem(node.data.itemId)
            else if (!node.data.editing) actions.stopEditing()
          }}
          // A note is edited in place; anything else opens in the panel.
          onNodeDoubleClick={(_, node) => {
            if (readOnly || node.data.editing) return
            const item = queryClient.getQueryData<Item>(itemKey(node.data.itemId))
            if (item?.kind === 'note') actions.startEditing(node.id)
            else actions.openItem(node.data.itemId)
          }}
          onPaneClick={actions.stopEditing}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} />
          <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
          {!readOnly && <MiniMap pannable zoomable />}
          {!readOnly && (
            <Panel position="top-right">
              <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
                <SaveStatus state={saveState} onRetry={() => saver.retryNow()} />
                <button
                  type="button"
                  className={toolButton}
                  title="⌘Z"
                  disabled={!history.canUndo}
                  onClick={() => travel('undo')}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className={toolButton}
                  title="⇧⌘Z"
                  disabled={!history.canRedo}
                  onClick={() => travel('redo')}
                >
                  Redo
                </button>
                <button
                  type="button"
                  className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                  onClick={() =>
                    setPanel((open) => (open && 'adding' in open ? null : { adding: true }))
                  }
                >
                  Add items
                </button>
              </div>
            </Panel>
          )}
          {nodes.length === 0 && !capturing && (
            <Panel position="top-center">
              <p className="mt-16 text-sm text-zinc-500">
                {readOnly
                  ? 'This board is empty.'
                  : 'An empty board. Add items, or paste or drop things here.'}
              </p>
            </Panel>
          )}
          <PendingDrops drops={visibleDrops} pending={pipeline.pending} />
        </ReactFlow>
        {pipeline.dragging && !readOnly && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-start justify-center rounded-2xl border-2 border-dashed border-zinc-400 bg-zinc-500/5 dark:border-zinc-500">
            <span className="mt-6 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Drop to add to this board
            </span>
          </div>
        )}
        {saveState.status === 'conflict' && (
          <div
            role="alert"
            className="absolute inset-x-0 top-0 z-10 mx-auto mt-2 flex w-fit max-w-[calc(100%-1rem)] flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm dark:border-amber-800 dark:bg-amber-950"
          >
            <span className="mr-auto">This board changed in another tab or device.</span>
            <button type="button" className={toolButton} onClick={() => resolveConflict('theirs')}>
              Load latest
            </button>
            <button type="button" className={toolButton} onClick={() => resolveConflict('mine')}>
              Keep mine
            </button>
          </div>
        )}
        {panel && 'adding' in panel && !readOnly && (
          <AddItemsPanel onBoard={onBoard} onAdd={add} onClose={() => setPanel(null)} />
        )}
        {panel && 'itemId' in panel && onBoard.has(panel.itemId) && (
          <ItemPanel
            key={panel.itemId}
            itemId={panel.itemId}
            onRemove={readOnly ? undefined : () => removeItem(panel.itemId)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
    </BoardContext>
  )
}

function SaveStatus({ state, onRetry }: { state: LayoutSaverState; onRetry: () => void }) {
  switch (state.status) {
    case 'saved':
      return <span className="px-2 text-xs text-zinc-500">Saved</span>
    case 'unsaved':
    case 'saving':
      return <span className="px-2 text-xs text-zinc-500">Saving…</span>
    case 'offline':
      return (
        <span
          className="px-2 text-xs text-amber-700 dark:text-amber-400"
          title="Kept on this device, it saves when the connection is back"
        >
          Offline
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 px-2 text-xs text-red-600" title={state.error}>
          Couldn't save
          <button type="button" className={toolButton} onClick={onRetry}>
            Retry
          </button>
        </span>
      )
    case 'conflict':
      return <span className="px-2 text-xs text-amber-700 dark:text-amber-400">Not saved</span>
  }
}
