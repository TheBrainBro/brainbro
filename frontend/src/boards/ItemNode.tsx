import {
  NodeResizer,
  NodeToolbar,
  Position,
  useReactFlow,
  useStore,
  type NodeProps,
  type ReactFlowState,
} from '@xyflow/react'
import { lazy, memo, Suspense } from 'react'

import type { Item } from '../items/api'
import { ItemContent } from '../items/ItemCard'
import { itemLabel } from '../items/label'
import { useBoardItem } from './api'
import { useBoardActions } from './context'
import type { ItemFlowNode } from './layout'

// CodeMirror loads the first time a note is edited on a board.
const NoteNodeEditor = lazy(() => import('./NoteNodeEditor'))

const KIND_LABEL: Record<Item['kind'], string> = {
  note: 'Note',
  link: 'Link',
  image: 'Image',
  file: 'File',
}

// Below this zoom cards are too small to read: a title is enough, and much
// cheaper than Markdown and thumbnails on a board with hundreds of them.
const DETAIL_ZOOM = 0.4
const zoomedOut = (state: ReactFlowState) => state.transform[2] < DETAIL_ZOOM

const toolButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/** A card on the canvas for one item, read from the cache by id. */
export const ItemNode = memo(function ItemNode({
  id,
  data,
  selected,
  height,
}: NodeProps<ItemFlowNode>) {
  const item = useBoardItem(data.itemId)
  const { readOnly, openItem, startEditing, stopEditing } = useBoardActions()
  const summary = useStore(zoomedOut)
  const flow = useReactFlow()
  const editing = Boolean(data.editing) && item?.kind === 'note'
  const ring = selected
    ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
    : 'border-zinc-200 dark:border-zinc-800'

  return (
    <>
      {!readOnly && (
        <>
          <NodeResizer
            isVisible={selected && !editing}
            minWidth={160}
            minHeight={48}
            color="#71717a"
          />
          {/* Only for a single selected card (React Flow's default). */}
          <NodeToolbar isVisible={editing ? false : undefined} position={Position.Top}>
            <div className="flex gap-0.5 rounded-lg border border-zinc-200 bg-white p-0.5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
              <button type="button" className={toolButton} onClick={() => openItem(data.itemId)}>
                Open
              </button>
              {item?.kind === 'note' && (
                <button type="button" className={toolButton} onClick={() => startEditing(id)}>
                  Edit
                </button>
              )}
              <button
                type="button"
                className={toolButton}
                title="Take it off this board (the item stays)"
                onClick={() => flow.deleteElements({ nodes: [{ id }] })}
              >
                Remove
              </button>
            </div>
          </NodeToolbar>
        </>
      )}
      <article
        className={`overflow-hidden rounded-xl border bg-white p-3 shadow-xs dark:bg-zinc-900 ${ring} ${
          height ? 'h-full' : ''
        } ${item?.status === 'archived' ? 'opacity-60' : ''}`}
      >
        {!item ? (
          <div className="h-6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
        ) : editing ? (
          <Suspense fallback={<ItemContent item={item} linkFile={false} />}>
            <NoteNodeEditor item={item} onDone={stopEditing} />
          </Suspense>
        ) : summary ? (
          <ItemSummary item={item} />
        ) : (
          <>
            {item.status === 'archived' && <p className="mb-1 text-xs text-zinc-500">Archived</p>}
            <ItemContent item={item} linkFile={false} fill={Boolean(height)} />
          </>
        )}
      </article>
    </>
  )
})

export function ItemSummary({ item }: { item: Item }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">
        {KIND_LABEL[item.kind]}
        {item.status === 'archived' && ' · Archived'}
      </p>
      <p className="line-clamp-2 font-medium break-words">{itemLabel(item)}</p>
    </div>
  )
}
