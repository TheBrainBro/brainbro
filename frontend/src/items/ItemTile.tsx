import type { ReactNode } from 'react'

import { timeAgo } from '../lib/time'
import type { Item } from './api'
import { ItemThumb } from './ItemThumb'
import { OriginMark } from './OriginMark'
import { itemLabel, KIND_LABEL, plainLinks } from './label'

type Props = {
  item: Item
  selected: boolean
  focused: boolean
  onToggleSelect: () => void
  /** Opens it: the editor for a note, the viewer for anything else. */
  onOpen: () => void
  actions: ReactNode
}

function border(selected: boolean, focused: boolean) {
  if (selected) return 'border-accent-500 ring-2 ring-accent-500/30'
  if (focused) return 'border-zinc-400 dark:border-zinc-600'
  return 'border-zinc-200 dark:border-zinc-800'
}

function Select({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      aria-label="Select"
      className={`shrink-0 accent-accent-600 transition-opacity ${selected ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
      checked={selected}
      onChange={onToggle}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

/** A tile in the grid: the item's picture (or a note's first lines) over its name. */
export function ItemTile({ item, selected, focused, onToggleSelect, onOpen, actions }: Props) {
  return (
    <article
      aria-current={focused || undefined}
      className={`group relative flex h-full flex-col overflow-hidden rounded-xl border bg-white shadow-xs transition hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${border(selected, focused)}`}
    >
      <button
        type="button"
        aria-label={`Open ${itemLabel(item)}`}
        className="block aspect-[4/3] w-full overflow-hidden bg-zinc-100 text-left dark:bg-zinc-800"
        onClick={onOpen}
      >
        {item.kind === 'note' ? (
          <p className="line-clamp-6 p-3 text-sm leading-relaxed whitespace-pre-line text-zinc-600 dark:text-zinc-300">
            {plainLinks(item.body)}
          </p>
        ) : (
          <ItemThumb item={item} className="size-full rounded-none" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium break-words">{itemLabel(item)}</p>
        <p className="mt-auto flex items-center gap-1.5 text-xs text-zinc-500">
          {KIND_LABEL[item.kind]} · {timeAgo(item.created_at)}
          <OriginMark item={item} />
        </p>
      </div>
      <div className="absolute top-2 left-2">
        <Select selected={selected} onToggle={onToggleSelect} />
      </div>
      <div className="absolute top-2 right-2">{actions}</div>
    </article>
  )
}

/** A row in the list: small picture, name, kind and age. */
export function ItemRow({ item, selected, focused, onToggleSelect, onOpen, actions }: Props) {
  return (
    <article
      aria-current={focused || undefined}
      className={`group flex items-center gap-3 rounded-xl border bg-white px-3 py-2 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60 ${border(selected, focused)}`}
    >
      <Select selected={selected} onToggle={onToggleSelect} />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={onOpen}
      >
        <ItemThumb item={item} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{itemLabel(item)}</span>
          <span className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
            {KIND_LABEL[item.kind]} · {timeAgo(item.created_at)}
            <OriginMark item={item} />
          </span>
        </span>
      </button>
      {actions}
    </article>
  )
}
