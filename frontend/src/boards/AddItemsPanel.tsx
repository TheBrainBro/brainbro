import { Check, Plus, Search, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'

import { useItems, type Item, type ItemKind, type ItemStatus } from '../items/api'
import { ItemThumb } from '../items/ItemThumb'
import { itemLabel, KIND_LABEL } from '../items/label'
import { timeAgo } from '../lib/time'
import { ITEM_DRAG_TYPE } from './layout'

const sources: { status?: ItemStatus; label: string }[] = [
  { status: 'inbox', label: 'Inbox' },
  { label: 'All' },
]

const kinds: { kind?: ItemKind; label: string }[] = [
  { label: 'Everything' },
  { kind: 'note', label: 'Notes' },
  { kind: 'link', label: 'Links' },
  { kind: 'image', label: 'Images' },
  { kind: 'file', label: 'Files' },
  { kind: 'audio', label: 'Audio' },
  { kind: 'album', label: 'Albums' },
]


/** Your items, to put on the board: with +, or dragged where they should go. */
export function AddItemsPanel({
  onBoard,
  onAdd,
  onClose,
}: {
  onBoard: Set<string>
  onAdd: (item: Item) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<ItemStatus | undefined>('inbox')
  const [kind, setKind] = useState<ItemKind | undefined>()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const items = useItems({ status, kind, q: q || undefined })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []

  return (
    <aside
      aria-label="Add items"
      className="absolute inset-y-0 right-0 z-10 flex w-96 max-w-full flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-1">
          <div role="tablist" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {sources.map((source) => (
              <button
                key={source.label}
                type="button"
                role="tab"
                aria-selected={status === source.status}
                className="rounded-md px-3 py-1 text-sm text-zinc-500 transition aria-selected:bg-white aria-selected:font-medium aria-selected:text-zinc-900 aria-selected:shadow-xs dark:aria-selected:bg-zinc-700 dark:aria-selected:text-zinc-100"
                onClick={() => setStatus(source.status)}
              >
                {source.label}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Close" className="button-icon ml-auto" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <label className="relative block">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search items"
            placeholder="Search"
            className="input pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-1" aria-label="Kind">
          {kinds.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={kind === option.kind}
              className="rounded-full border border-zinc-200 px-2.5 py-0.5 text-xs text-zinc-600 transition hover:border-zinc-300 aria-pressed:border-accent-500 aria-pressed:bg-accent-50 aria-pressed:text-accent-700 dark:border-zinc-700 dark:text-zinc-300 dark:aria-pressed:bg-accent-500/15 dark:aria-pressed:text-accent-300"
              onClick={() => setKind(option.kind)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.isSuccess && all.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-zinc-500">
            {q ? 'Nothing matches.' : 'Nothing here.'}
          </li>
        )}
        {all.map((item) => {
          const placed = onBoard.has(item.id)
          return (
            <li
              key={item.id}
              draggable={!placed}
              title={placed ? undefined : 'Drag onto the board'}
              onDragStart={(event) => {
                event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(item))
                event.dataTransfer.effectAllowed = 'copy'
              }}
              className={`group flex items-center gap-3 rounded-xl p-2 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${
                placed ? 'opacity-60' : 'cursor-grab active:cursor-grabbing'
              }`}
            >
              <ItemThumb item={item} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium break-words">{itemLabel(item)}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {KIND_LABEL[item.kind]} · {timeAgo(item.created_at)}
                </p>
              </div>
              {placed ? (
                <span className="flex size-8 shrink-0 items-center justify-center text-zinc-400">
                  <Check className="size-4" aria-label="On board" />
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Add ${itemLabel(item)}`}
                  className="button-icon size-8 shrink-0 border border-zinc-200 dark:border-zinc-700"
                  onClick={() => onAdd(item)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          )
        })}
        {items.hasNextPage && (
          <li>
            <button
              type="button"
              className="w-full rounded-lg py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              disabled={items.isFetchingNextPage}
              onClick={() => items.fetchNextPage()}
            >
              {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </li>
        )}
      </ul>
    </aside>
  )
}
