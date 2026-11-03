import {
  NodeResizer,
  NodeToolbar,
  Position,
  useReactFlow,
  useStore,
  type NodeProps,
  type ReactFlowState,
} from '@xyflow/react'
import { Maximize2, Pencil, X } from 'lucide-react'
import { lazy, memo, Suspense } from 'react'

import { useT } from '../i18n/i18n'
import type { Item } from '../items/api'
import { ItemContent } from '../items/ItemCard'
import { itemLabel, KIND_LABEL } from '../items/label'
import { useBoardItem } from './api'
import { ConnectHandles } from './ConnectHandles'
import { useBoardActions } from './context'
import type { ItemFlowNode } from './layout'

// CodeMirror loads the first time a note is edited on a board.
const NoteNodeEditor = lazy(() => import('./NoteNodeEditor'))


// Below this zoom cards are too small to read: a title is enough, and much
// cheaper than Markdown and thumbnails on a board with hundreds of them.
const DETAIL_ZOOM = 0.4
const zoomedOut = (state: ReactFlowState) => state.transform[2] < DETAIL_ZOOM

/** A card on the canvas for one item, read from the cache by id. */
export const ItemNode = memo(function ItemNode({
  id,
  data,
  selected,
  height,
}: NodeProps<ItemFlowNode>) {
  const t = useT()
  const item = useBoardItem(data.itemId)
  const { readOnly, openItem, startEditing, stopEditing } = useBoardActions()
  const summary = useStore(zoomedOut)
  const flow = useReactFlow()
  const editing = Boolean(data.editing) && item?.kind === 'note'
  const ring = selected
    ? 'border-accent-500 ring-2 ring-accent-500/30'
    : 'border-zinc-200 dark:border-zinc-800'

  return (
    <>
      {!readOnly && (
        <>
          <NodeResizer
            isVisible={selected && !editing}
            minWidth={160}
            minHeight={48}
            color="#8b5cf6"
          />
          {/* Only for a single selected card (React Flow's default). */}
          <NodeToolbar isVisible={editing ? false : undefined} position={Position.Top}>
            <div className="popover flex gap-0.5 p-1">
              <ToolButton label={t('nodes.open')} icon={Maximize2} onClick={() => openItem(data.itemId)} />
              {item?.kind === 'note' && (
                <ToolButton label={t('nodes.edit')} icon={Pencil} onClick={() => startEditing(id)} />
              )}
              <ToolButton
                label={t('nodes.removeFromBoard')}
                icon={X}
                onClick={() => flow.deleteElements({ nodes: [{ id }] })}
              />
            </div>
          </NodeToolbar>
        </>
      )}
      <article
        data-tutorial="board-node"
        className={`overflow-hidden rounded-xl border bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900 ${ring} ${
          height ? 'h-full' : ''
        } ${item?.status === 'archived' ? 'opacity-60' : ''}`}
      >
        {!item ? (
          <div className="skeleton h-6" />
        ) : (
          <>
          {editing ? (
            <Suspense fallback={<ItemContent item={item} />}>
              <NoteNodeEditor item={item} onDone={stopEditing} />
            </Suspense>
          ) : summary ? (
            <ItemSummary item={item} />
          ) : (
            <>
              {item.status === 'archived' && (
                <p className="mb-1 text-xs text-zinc-500">{t('nodes.archived')}</p>
              )}
              <ItemContent item={item} fill={Boolean(height)} />
            </>
          )}
          </>
        )}
      </article>
      {!editing && <ConnectHandles id={id} readOnly={readOnly} />}
    </>
  )
})

function ToolButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: typeof X
  onClick: () => void
}) {
  return (
    <button type="button" aria-label={label} className="button-icon group/tip size-7" onClick={onClick}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="tooltip bottom-full mb-1">{label}</span>
    </button>
  )
}

export function ItemSummary({ item }: { item: Item }) {
  const t = useT()
  return (
    <div className="min-w-0">
      <p className="text-xs text-zinc-500">
        {KIND_LABEL[item.kind]}
        {item.status === 'archived' && ` · ${t('nodes.archived')}`}
      </p>
      <p className="line-clamp-2 font-medium break-words">{itemLabel(item)}</p>
    </div>
  )
}
