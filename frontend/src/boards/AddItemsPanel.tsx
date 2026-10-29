import { useState } from 'react'

import { useItems, type Item, type ItemStatus } from '../items/api'
import { ItemSummary } from './ItemNode'

const sources: { status?: ItemStatus; label: string }[] = [
  { status: 'inbox', label: 'Inbox' },
  { label: 'All' },
]

/** Your items, to put on the board one by one. */
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
  const items = useItems({ status })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []

  return (
    <aside
      aria-label="Add items"
      className="absolute inset-y-0 right-0 z-10 flex w-80 max-w-full flex-col border-l border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
        {sources.map((source) => (
          <button
            key={source.label}
            type="button"
            aria-pressed={status === source.status}
            className="rounded-md px-2 py-1 text-sm aria-pressed:bg-zinc-100 aria-pressed:font-medium dark:aria-pressed:bg-zinc-800"
            onClick={() => setStatus(source.status)}
          >
            {source.label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Close"
          className="ml-auto rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.isSuccess && all.length === 0 && (
          <li className="p-2 text-sm text-zinc-500">Nothing here.</li>
        )}
        {all.map((item) => {
          const placed = onBoard.has(item.id)
          return (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
            >
              <div className="min-w-0 flex-1 text-sm">
                <ItemSummary item={item} />
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md border border-zinc-200 px-2 py-1 text-xs font-medium disabled:border-transparent disabled:text-zinc-400 dark:border-zinc-700"
                disabled={placed}
                onClick={() => onAdd(item)}
              >
                {placed ? 'On board' : 'Add'}
              </button>
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
