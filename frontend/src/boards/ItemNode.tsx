import { NodeResizer, type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import type { Item } from '../items/api'
import { itemLabel } from '../items/label'
import { useBoardItem } from './api'
import { useBoardActions } from './context'
import type { ItemFlowNode } from './layout'

const KIND_LABEL: Record<Item['kind'], string> = {
  note: 'Note',
  link: 'Link',
  image: 'Image',
  file: 'File',
}

/** A card on the canvas for one item, read from the cache by id. */
export const ItemNode = memo(function ItemNode({ data, selected, height }: NodeProps<ItemFlowNode>) {
  const item = useBoardItem(data.itemId)
  const { readOnly } = useBoardActions()
  const ring = selected
    ? 'border-zinc-900 ring-1 ring-zinc-900 dark:border-zinc-100 dark:ring-zinc-100'
    : 'border-zinc-200 dark:border-zinc-800'

  return (
    <>
      {!readOnly && (
        <NodeResizer isVisible={selected} minWidth={160} minHeight={48} color="#71717a" />
      )}
      <article
        className={`overflow-hidden rounded-xl border bg-white p-3 shadow-xs dark:bg-zinc-900 ${ring} ${
          height ? 'h-full' : ''
        } ${item?.status === 'archived' ? 'opacity-60' : ''}`}
      >
        {item ? <ItemSummary item={item} /> : <div className="h-6 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />}
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
