import { CaptureBox } from '../items/CaptureBox'
import { ItemList } from '../items/ItemList'
import { useItems } from '../items/api'

export function InboxPage() {
  const items = useItems({ status: 'inbox' })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8">
      <div className="sticky top-0 z-10 bg-zinc-50/90 pt-8 pb-4 backdrop-blur dark:bg-zinc-950/90">
        <h1 className="mb-3 text-2xl font-semibold">Inbox</h1>
        <CaptureBox />
      </div>

      {items.isError && (
        <p role="alert" className="text-sm text-red-600">
          {items.error.message}
        </p>
      )}
      {items.isSuccess && all.length === 0 && (
        <p className="py-12 text-center text-zinc-500">
          Inbox zero. Paste a link or a thought to drop it here.
        </p>
      )}

      <ItemList items={all} />

      {items.hasNextPage && (
        <button
          type="button"
          className="mt-4 w-full rounded-lg py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          disabled={items.isFetchingNextPage}
          onClick={() => items.fetchNextPage()}
        >
          {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
