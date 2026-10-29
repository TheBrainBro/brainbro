import '@xyflow/react/dist/style.css'

import { useQueryClient } from '@tanstack/react-query'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import {
  Frame,
  Group,
  Hand,
  Link2,
  MousePointer2,
  NotebookPen,
  PenLine,
  Plus,
  Redo2,
  StickyNote,
  Undo2,
  Upload,
  type LucideIcon,
} from 'lucide-react'
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
import { useViewer } from '../viewer/context'
import { AddItemsPanel } from './AddItemsPanel'
import { boardKey, boardsKey, saveLayout, seedItems, type Board } from './api'
import { BoardContext, type BoardActions } from './context'
import { EDGE_COLOR, EDGE_SELECTED, FloatingEdge } from './FloatingEdge'
import { Composer, type ComposerKind } from './Composer'
import { FrameDraw } from './FrameDraw'
import { FrameNode } from './FrameNode'
import { ItemNode } from './ItemNode'
import {
  connected,
  DEFAULT_WIDTH,
  drawFrame,
  dropSpot,
  dropSpots,
  freeSpot,
  groupNodes,
  isFrame,
  isItem,
  isSticky,
  ITEM_DRAG_TYPE,
  newNodeId,
  newSticky,
  newStroke,
  PALETTE,
  obstacles,
  settle,
  toScene,
  ungroup,
  type BoardEdge,
  type BoardNode,
  type Box,
  type Scene,
} from './layout'
import { PenDraw } from './PenDraw'
import { PendingDrops, type Drop } from './PendingDrops'
import { layoutDrafts, type LayoutSaverState } from './saver'
import { BoardSession } from './session'
import { StickyNode } from './StickyNode'
import { StrokeNode } from './StrokeNode'

// Outside the component: React Flow remounts every node if these change.
const nodeTypes = { item: ItemNode, frame: FrameNode, sticky: StickyNode, stroke: StrokeNode }
const edgeTypes = { floating: FloatingEdge }

/** What a drag (or click) on the canvas does: select, pan, or draw something. */
type Tool = 'select' | 'hand' | 'sticky' | 'pen' | 'frame'

const TOOLS: { tool: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { tool: 'hand', label: 'Pan', key: 'H', icon: Hand },
  { tool: 'sticky', label: 'Sticky note', key: 'S', icon: StickyNote },
  { tool: 'pen', label: 'Pen', key: 'P', icon: PenLine },
  { tool: 'frame', label: 'Group', key: 'F', icon: Frame },
]

const PEN_WIDTHS = [2, 4, 8]

// Drag with the middle button to pan while selecting.
const MIDDLE_BUTTON = [1]

// Zoom to fit never blows a few cards up past their real size.
const fitViewOptions = { maxZoom: 1 }

const toolButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800'

/** The end of a gesture: a drag dropped, a resize let go, nodes deleted. */
function isCommit(change: NodeChange<BoardNode>) {
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

/** Edges as React Flow draws them: arrowheads in the edge's color. */
function withMarkers(edge: BoardEdge): BoardEdge {
  const arrow = edge.data?.arrow ?? 'end'
  const marker = {
    type: MarkerType.ArrowClosed,
    color: edge.selected ? EDGE_SELECTED : edge.data?.color || EDGE_COLOR,
    width: 16,
    height: 16,
  }
  return {
    ...edge,
    markerEnd: arrow === 'none' ? undefined : marker,
    markerStart: arrow === 'both' ? marker : undefined,
  }
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
  const flow = useReactFlow<BoardNode, BoardEdge>()
  const container = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const pipeline = useCapturePipeline()
  const [, historyChanged] = useReducer((count: number) => count + 1, 0)
  const [adding, setAdding] = useState(false)
  const viewer = useViewer()
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
  const [tool, setTool] = useState<Tool>('select')
  const [pen, setPen] = useState({ color: '', width: 2 })
  // Writing a note or a link to put on the board.
  const [composing, setComposing] = useState<ComposerKind | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [initial] = useState(() => session.initialScene)
  const [nodes, setNodes] = useState(initial.nodes)
  const [edges, setEdges] = useState(initial.edges)
  // Changes and commits arrive in the same tick: commits read these, not state.
  const latest = useRef(nodes)
  const latestEdges = useRef(edges)
  // Dragged and let go: they may have moved into a group, or out of one.
  const settling = useRef(new Set<string>())
  const commitQueued = useRef(false)

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

  // Stable (refs and setters only), so the cards' actions can be too.
  const { show, commit } = useMemo(() => {
    function show(next: Partial<Scene>) {
      if (next.nodes) {
        latest.current = next.nodes
        setNodes(next.nodes)
      }
      if (next.edges) {
        latestEdges.current = next.edges
        setEdges(next.edges)
      }
    }
    // One gesture can change nodes and edges in turn (deleting a card takes
    // its edges): commit once, after all of it.
    function commit() {
      if (readOnly || commitQueued.current) return
      commitQueued.current = true
      queueMicrotask(() => {
        commitQueued.current = false
        let nodes = latest.current
        if (settling.current.size > 0) {
          nodes = settle(nodes, [...settling.current])
          settling.current.clear()
        }
        const edges = connected(nodes, latestEdges.current)
        show({ nodes, edges })
        if (session.commit({ nodes, edges }, flow.getViewport())) historyChanged()
      })
    }
    return { show, commit }
  }, [readOnly, session, flow])

  function onNodesChange(changes: NodeChange<BoardNode>[]) {
    for (const change of changes) {
      if (change.type === 'position' && change.dragging === false) settling.current.add(change.id)
    }
    show({ nodes: applyNodeChanges(changes, latest.current) })
    if (changes.some(isCommit)) commit()
  }

  function onEdgesChange(changes: EdgeChange<BoardEdge>[]) {
    show({ edges: applyEdgeChanges(changes, latestEdges.current) })
    if (changes.some((change) => change.type === 'remove')) commit()
  }

  function onConnect(connection: Connection) {
    const { source, target } = connection
    if (source === target) return
    const exists = latestEdges.current.some(
      (edge) =>
        (edge.source === source && edge.target === target) ||
        (edge.source === target && edge.target === source),
    )
    if (exists) return
    const edge: BoardEdge = {
      id: `e-${crypto.randomUUID()}`,
      type: 'floating',
      source,
      target,
      selected: true,
      data: { label: '', arrow: 'end', stroke: 'solid', color: '' },
    }
    show({
      nodes: latest.current.map((node) => (node.selected ? { ...node, selected: false } : node)),
      edges: [...latestEdges.current.map((other) => ({ ...other, selected: false })), edge],
    })
    commit()
  }

  /** A new group around what is selected (⌘G). */
  function groupSelection() {
    const ids = latest.current.filter((node) => node.selected).map((node) => node.id)
    const next = groupNodes(latest.current, ids, newNodeId())
    if (!next) return
    show({ nodes: next })
    commit()
  }

  /** Takes the selected groups away, keeping what they hold (⇧⌘G). */
  function ungroupSelection() {
    const frames = latest.current.filter((node) => node.selected && isFrame(node))
    if (frames.length === 0) return
    let next = latest.current
    for (const frame of frames) next = ungroup(next, frame.id)
    show({ nodes: next })
    commit()
  }

  /** A sticky note where the canvas was clicked, ready to type in. */
  function placeSticky(at: { x: number; y: number }) {
    setTool('select')
    const sticky = newSticky(flow.screenToFlowPosition(at), newNodeId())
    show({
      nodes: [
        ...latest.current.map((node) => (node.selected ? { ...node, selected: false } : node)),
        sticky,
      ],
    })
    settling.current.add(sticky.id)
    commit()
  }

  function onPenDrawn(screen: { x: number; y: number }[]) {
    const points = screen.map((point) => flow.screenToFlowPosition(point))
    const stroke = newStroke(points, pen, newNodeId())
    if (!stroke) return
    show({ nodes: [...latest.current, stroke] })
    settling.current.add(stroke.id)
    commit()
  }

  function onFrameDrawn(screen: Box) {
    setTool('select')
    const corner = flow.screenToFlowPosition({ x: screen.x, y: screen.y })
    const far = flow.screenToFlowPosition({ x: screen.x + screen.width, y: screen.y + screen.height })
    // A click rather than a drag: a group of a useful size there.
    const box =
      screen.width < 12 && screen.height < 12
        ? { x: corner.x, y: corner.y, width: 480, height: 320 }
        : { x: corner.x, y: corner.y, width: far.x - corner.x, height: far.y - corner.y }
    show({ nodes: drawFrame(latest.current, box, newNodeId()) })
    commit()
  }

  function travel(direction: 'undo' | 'redo') {
    const next = session.travel(direction, flow.getViewport())
    if (!next) return
    show(next)
    historyChanged()
  }

  /** Puts an item on the board at `position` (if it isn't there already) and commits. */
  function place(item: Item, position: { x: number; y: number }, select: boolean) {
    if (latest.current.some((node) => isItem(node) && node.data.itemId === item.id)) return
    queryClient.setQueryData(itemKey(item.id), item)
    session.place()
    const others = select
      ? latest.current.map((node) => (node.selected ? { ...node, selected: false } : node))
      : latest.current
    const id = newNodeId()
    show({
      nodes: [
        ...others,
        {
          id,
          type: 'item',
          position,
          width: DEFAULT_WIDTH[item.kind],
          data: { itemId: item.id },
          selected: select,
        },
      ],
    })
    // Dropped on a group, it goes in it.
    settling.current.add(id)
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
    place(item, freeSpot(pastePoint(), DEFAULT_WIDTH[item.kind], obstacles(latest.current)), true)
  }

  /** A paste or a drop: captured like anywhere else, each card placed once its item exists. */
  function captureHere(found: CaptureInputs, at: { x: number; y: number } | null) {
    const point = at ? flow.screenToFlowPosition(at) : pastePoint()
    pipeline.capture(found, {
      // Taking a card off the board is the undo here (⌘Z); the item stays.
      undo: false,
      // Each image is a card of its own here.
      album: false,
      onQueued: (ids) => {
        const widths = ids.map((_, index) => widthFor(found.inputs[index]))
        const taken = [...obstacles(latest.current), ...latestDrops.current]
        const spots = dropSpots(point, widths, taken)
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
    place(item, dropSpot(point, DEFAULT_WIDTH[item.kind], obstacles(latest.current)), true)
  }

  function resolveConflict(side: 'mine' | 'theirs') {
    const theirs = session.resolve(side)
    if (!theirs) return
    seedItems(queryClient, theirs.items)
    queryClient.setQueryData(boardKey(board.id), theirs)
    historyChanged()
    show(toScene(theirs.layout))
  }

  const shortcut = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if (event.metaKey || event.ctrlKey) {
      if (key === 'z' || key === 'y') {
        event.preventDefault()
        travel(key === 'y' || event.shiftKey ? 'redo' : 'undo')
      } else if (key === 'g') {
        event.preventDefault()
        if (event.shiftKey) ungroupSelection()
        else groupSelection()
      }
      return
    }
    if (event.altKey || event.shiftKey) return
    const chosen = TOOLS.find((candidate) => candidate.key.toLowerCase() === key)
    if (chosen) setTool(chosen.tool)
    else if (key === 'n') setComposing('note')
    else if (key === 'l') setComposing('link')
    else if (key === 'escape') setTool('select')
  })
  useEffect(() => {
    if (readOnly) return
    function onKeyDown(event: KeyboardEvent) {
      if (!isEditable(event.target)) shortcut(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readOnly])

  const onBoard = useMemo(
    () => new Set(nodes.filter(isItem).map((node) => node.data.itemId)),
    [nodes],
  )
  const selected = nodes.filter((node) => node.selected)
  // Stable, so cards don't re-render when the canvas does.
  const actions = useMemo((): BoardActions => {
    function setEditing(nodeId: string | null) {
      if (!nodeId && !latest.current.some((node) => isItem(node) && node.data.editing)) return
      const next = latest.current.map((node) =>
        !isItem(node) || Boolean(node.data.editing) === (node.id === nodeId)
          ? node
          : { ...node, data: { ...node.data, editing: node.id === nodeId } },
      )
      show({ nodes: next })
    }
    function removeNode(itemId: string) {
      const node = latest.current.find(
        (candidate) => isItem(candidate) && candidate.data.itemId === itemId,
      )
      if (node) flow.deleteElements({ nodes: [{ id: node.id }] })
    }
    function updateFrame(id: string, patch: { title?: string; color?: string }) {
      show({
        nodes: latest.current.map((node) =>
          node.id === id && isFrame(node) ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      })
      commit()
    }
    return {
      readOnly,
      // In the viewer, stepping through the board's cards in order.
      openItem: (itemId) => {
        const items = latest.current
          .filter(isItem)
          .map((node) => queryClient.getQueryData<Item>(itemKey(node.data.itemId)))
          .filter((item): item is Item => Boolean(item))
        const index = items.findIndex((item) => item.id === itemId)
        if (index === -1) return
        viewer.open(items, index, {
          actions: readOnly
            ? undefined
            : (item, close) => (
                <button
                  type="button"
                  className="viewer-button"
                  title="Take it off this board (the item stays)"
                  onClick={() => {
                    removeNode(item.id)
                    close()
                  }}
                >
                  Remove from board
                </button>
              ),
        })
      },
      startEditing: (nodeId) => setEditing(nodeId),
      stopEditing: () => setEditing(null),
      renameFrame: (id, title) => updateFrame(id, { title }),
      recolorFrame: (id, color) => updateFrame(id, { color }),
      ungroupFrame: (id) => {
        show({ nodes: ungroup(latest.current, id) })
        commit()
      },
      updateSticky: (id, patch) => {
        show({
          nodes: latest.current.map((node) =>
            node.id === id && isSticky(node) ? { ...node, data: { ...node.data, ...patch } } : node,
          ),
        })
        commit()
      },
      editSticky: (id) => {
        show({
          nodes: latest.current.map((node) =>
            node.id === id && isSticky(node) ? { ...node, data: { ...node.data, editing: true } } : node,
          ),
        })
      },
      updateEdge: (id, patch) => {
        show({
          edges: latestEdges.current.map((edge) =>
            edge.id === id && edge.data ? { ...edge, data: { ...edge.data, ...patch } } : edge,
          ),
        })
        commit()
      },
    }
  }, [readOnly, show, commit, queryClient, viewer, flow])

  const shownEdges = useMemo(() => edges.map(withMarkers), [edges])


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
          edges={shownEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Strict}
          connectionRadius={24}
          connectionLineStyle={{ stroke: EDGE_SELECTED, strokeWidth: 2 }}
          // Groups stay under the cards around them, selected or not.
          elevateNodesOnSelect={false}
          defaultViewport={board.layout.viewport}
          // A phone shows the whole board; a desktop comes back where it was.
          fitView={readOnly}
          minZoom={0.05}
          maxZoom={4}
          onlyRenderVisibleElements
          colorMode="system"
          nodesDraggable={!readOnly && tool === 'select'}
          nodesConnectable={!readOnly && tool === 'select'}
          elementsSelectable={!readOnly && tool === 'select'}
          // As in design tools: drag selects, scroll pans, pinch or ⌘-scroll zooms.
          selectionOnDrag={!readOnly && tool === 'select'}
          panOnDrag={readOnly || tool === 'hand' ? true : MIDDLE_BUTTON}
          panOnScroll={!readOnly}
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          fitViewOptions={fitViewOptions}
          // On a phone a tap opens the item; on a desktop a click selects.
          onNodeClick={(_, node) => {
            if (!isItem(node)) return
            if (readOnly) actions.openItem(node.data.itemId)
            else if (!node.data.editing) actions.stopEditing()
          }}
          // A note is edited in place; anything else opens in the viewer.
          onNodeDoubleClick={(_, node) => {
            if (readOnly || !isItem(node) || node.data.editing) return
            const item = queryClient.getQueryData<Item>(itemKey(node.data.itemId))
            if (item?.kind === 'note') actions.startEditing(node.id)
            else actions.openItem(node.data.itemId)
          }}
          onPaneClick={(event) => {
            actions.stopEditing()
            if (tool === 'sticky') placeSticky({ x: event.clientX, y: event.clientY })
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} />
          <Controls showInteractive={false} fitViewOptions={fitViewOptions} />
          {!readOnly && <MiniMap pannable zoomable />}
          {!readOnly && (
            <Panel position="top-right">
              <div className="surface flex items-center rounded-lg p-1">
                <SaveStatus state={saveState} onRetry={() => saver.retryNow()} />
              </div>
            </Panel>
          )}
          {!readOnly && (
            <Panel position="bottom-center">
              <div role="toolbar" aria-label="Tools" className="popover flex items-center gap-0.5 p-1">
                {TOOLS.map(({ tool: value, label, key, icon }) => (
                  <ToolButton
                    key={value}
                    label={`${label} (${key})`}
                    icon={icon}
                    pressed={tool === value}
                    onClick={() => setTool(value)}
                  />
                ))}
                <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
                <ToolButton
                  label="Note (N)"
                  icon={NotebookPen}
                  pressed={composing === 'note'}
                  onClick={() => setComposing((open) => (open === 'note' ? null : 'note'))}
                />
                <ToolButton
                  label="Link (L)"
                  icon={Link2}
                  pressed={composing === 'link'}
                  onClick={() => setComposing((open) => (open === 'link' ? null : 'link'))}
                />
                <ToolButton
                  label="Upload files"
                  icon={Upload}
                  onClick={() => upload.current?.click()}
                />
                <input
                  ref={upload}
                  type="file"
                  multiple
                  hidden
                  aria-label="Upload files"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    if (files.length === 0) return
                    const inputs = files.map((file) => ({ kind: 'file' as const, file }))
                    captureHere({ inputs, skipped: [] }, null)
                  }}
                />
                <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
                <ToolButton
                  label="Undo (⌘Z)"
                  icon={Undo2}
                  disabled={!history.canUndo}
                  onClick={() => travel('undo')}
                />
                <ToolButton
                  label="Redo (⇧⌘Z)"
                  icon={Redo2}
                  disabled={!history.canRedo}
                  onClick={() => travel('redo')}
                />
                <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />
                <button
                  type="button"
                  aria-pressed={adding}
                  className="button-primary flex items-center gap-1.5 px-3 py-1.5"
                  onClick={() => setAdding((open) => !open)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add items
                </button>
              </div>
            </Panel>
          )}
          {!readOnly && selected.length > 1 && (
            <NodeToolbar nodeId={selected.map((node) => node.id)} isVisible position={Position.Top}>
              <div className="popover flex items-center gap-1 p-1">
                <span className="px-2 text-xs text-zinc-500">{selected.length} selected</span>
                <button type="button" className={toolButton} onClick={groupSelection}>
                  <Group className="mr-1 inline size-3.5" aria-hidden="true" />
                  Group (⌘G)
                </button>
              </div>
            </NodeToolbar>
          )}
          {!readOnly && tool === 'pen' && (
            <Panel position="bottom-center" className="!mb-16">
              <div className="popover flex items-center gap-1 p-1.5" aria-label="Pen">
                <PenColors value={pen.color} onChange={(color) => setPen({ ...pen, color })} />
                <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
                {PEN_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    aria-label={`${width} px`}
                    aria-pressed={pen.width === width}
                    className="button-icon size-7 aria-pressed:bg-zinc-100 dark:aria-pressed:bg-zinc-800"
                    onClick={() => setPen({ ...pen, width })}
                  >
                    <span
                      className="rounded-full bg-current"
                      style={{ width: width + 2, height: width + 2 }}
                    />
                  </button>
                ))}
              </div>
            </Panel>
          )}
          {!readOnly && composing && (
            <Panel position="bottom-center" className="!mb-16">
              <Composer
                kind={composing}
                onDone={(text) => {
                  setComposing(null)
                  if (!text) return
                  const input =
                    composing === 'link'
                      ? { kind: 'url' as const, url: text }
                      : { kind: 'note' as const, text }
                  captureHere({ inputs: [input], skipped: [] }, null)
                }}
              />
            </Panel>
          )}
          {nodes.length === 0 && !capturing && (
            <Panel position="top-center" className="pointer-events-none">
              {readOnly ? (
                <p className="mt-16 text-sm text-zinc-500">This board is empty.</p>
              ) : (
                <div className="mt-24 max-w-md text-center text-zinc-500">
                  <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">
                    An empty board
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">
                    Paste (<span className="kbd">⌘</span> <span className="kbd">V</span>) or drop
                    links, text and files anywhere here. Press <span className="kbd">N</span> for
                    a note, <span className="kbd">S</span> for a sticky,{' '}
                    <span className="kbd">P</span> to draw, or pick from <em>Add items</em>.
                  </p>
                </div>
              )}
            </Panel>
          )}
          <PendingDrops drops={visibleDrops} pending={pipeline.pending} />
          {/* Over the cards, under the toolbars (React Flow's panels). */}
          {tool === 'frame' && !readOnly && <FrameDraw onDraw={onFrameDrawn} />}
          {tool === 'pen' && !readOnly && (
            <PenDraw
              color={pen.color}
              width={pen.width}
              zoom={flow.getZoom()}
              onDraw={onPenDrawn}
            />
          )}
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
        {adding && !readOnly && (
          <AddItemsPanel onBoard={onBoard} onAdd={add} onClose={() => setAdding(false)} />
        )}
      </div>
    </BoardContext>
  )
}

function PenColors({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Pen color" className="flex items-center gap-1 px-1">
      {PALETTE.map((color) => (
        <button
          key={color || 'default'}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color || 'Ink'}
          className={`size-4 rounded-full transition hover:scale-110 ${
            color ? '' : 'bg-zinc-800 dark:bg-zinc-100'
          } ${value === color ? 'ring-2 ring-accent-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900' : ''}`}
          style={color ? { background: color } : undefined}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function ToolButton({
  label,
  icon: Icon,
  pressed,
  disabled,
  onClick,
}: {
  label: string
  icon: LucideIcon
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className={`button-icon group ${
        pressed ? 'bg-accent-100 text-accent-700 hover:bg-accent-100 dark:bg-accent-500/20 dark:text-accent-300' : ''
      }`}
      onClick={onClick}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      <span className="tooltip bottom-full mb-2">{label}</span>
    </button>
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
