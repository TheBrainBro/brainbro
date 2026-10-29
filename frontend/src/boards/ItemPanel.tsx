import { Link } from 'react-router'

import { ItemContent } from '../items/ItemCard'
import { useBoardItem } from './api'

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * An item of the board shown whole: a panel on the right, a sheet from the
 * bottom on phones.
 */
export function ItemPanel({
  itemId,
  onRemove,
  onClose,
}: {
  itemId: string
  /** Absent when the board is read-only. */
  onRemove?: () => void
  onClose: () => void
}) {
  const item = useBoardItem(itemId)

  return (
    <aside
      aria-label="Item"
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-2xl border-t border-zinc-200 bg-white shadow-lg md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-96 md:rounded-none md:border-t-0 md:border-l dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-1 border-b border-zinc-200 p-2 dark:border-zinc-800">
        {item?.kind === 'note' && (
          <Link to={`/notes/${item.id}`} className={actionButton}>
            Open note
          </Link>
        )}
        {onRemove && (
          <button
            type="button"
            className={actionButton}
            title="Take it off this board (the item stays)"
            onClick={onRemove}
          >
            Remove from board
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          className="ml-auto rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto p-4">
        {/* Whole: notes aren't cut off here. */}
        {item ? <ItemContent item={item} fill /> : <p className="text-zinc-500">Loading…</p>}
      </div>
    </aside>
  )
}
