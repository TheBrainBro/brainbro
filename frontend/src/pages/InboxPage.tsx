import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { CaptureBox } from '../items/CaptureBox'
import { ItemList } from '../items/ItemList'
import { useItems } from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { ViewModeSwitch } from '../items/ViewModeSwitch'
import { isEditable } from '../lib/dom'

export function InboxPage() {
  const items = useItems({ status: 'inbox' })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []
  const { pending } = useCapturePipeline()
  const navigate = useNavigate()
  const [mode, setMode] = useViewMode('inbox')

  // `n` starts a note in the editor; it reaches the inbox once it has text.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditable(event.target)) return
      event.preventDefault()
      navigate('/notes/new')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  return (
    <div className={`mx-auto ${MODE_WIDTH[mode]} px-4 pb-8 transition-[max-width]`}>
      <div className="sticky top-0 z-10 bg-zinc-50/90 pt-8 pb-4 backdrop-blur dark:bg-zinc-950/90">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="mr-auto text-2xl font-semibold">Inbox</h1>
          <ViewModeSwitch mode={mode} onChange={setMode} />
          <Link
            to="/notes/new"
            title="New note (N)"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            New note
          </Link>
        </div>
        <CaptureBox />
      </div>

      {items.isError && (
        <p role="alert" className="text-sm text-red-600">
          {items.error.message}
        </p>
      )}
      {items.isSuccess && all.length === 0 && pending.length === 0 && (
        <p className="py-12 text-center text-zinc-500">
          Inbox zero. Paste or drop a link, a thought or a file here.
        </p>
      )}

      {pending.length > 0 && (
        <ul className="mb-3 space-y-3" aria-label="Capturing">
          {pending.map((entry) => (
            <li key={entry.id}>
              <PendingCard entry={entry} />
            </li>
          ))}
        </ul>
      )}

      <ItemList items={all} mode={mode} />

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
