import { Archive, Inbox, SquarePen } from 'lucide-react'
import { useEffect } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { CaptureBox } from '../items/CaptureBox'
import { ItemList } from '../items/ItemList'
import { ItemListSkeleton } from '../items/ItemListSkeleton'
import { useItems } from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { LoadMore } from '../items/LoadMore'
import { ViewModeSwitch } from '../items/ViewModeSwitch'
import { isEditable } from '../lib/dom'
import { MOD } from '../lib/keys'
import { EmptyState, ErrorState } from '../ui/states'

const TAB =
  'rounded-md px-1 text-2xl font-semibold transition aria-[current=page]:text-zinc-900 dark:aria-[current=page]:text-zinc-100 text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400'

/** The inbox, or with `archived` what was archived, to bring back or delete. */
export function InboxPage({ archived = false }: { archived?: boolean }) {
  const items = useItems({ status: archived ? 'archived' : 'inbox' })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []
  const captures = useCapturePipeline().pending.filter((entry) => !entry.collection)
  // Captures land in the inbox: that is where they show.
  const pending = archived ? [] : captures
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
    <div className="px-4 pb-8">
      {/* The header keeps one width; only the list below follows the view mode. */}
      <div className="sticky top-0 z-10 -mx-4 bg-zinc-50/90 px-4 pt-8 pb-4 backdrop-blur dark:bg-zinc-950/90">
        <div className={`mx-auto ${MODE_WIDTH.cards}`}>
          <div className="mb-3 flex items-center gap-2">
            <h1 className="sr-only">{archived ? 'Archive' : 'Inbox'}</h1>
            <nav aria-label="Inbox or archive" className="mr-auto flex items-baseline gap-3">
              <NavLink to="/" end className={TAB}>
                Inbox
              </NavLink>
              <NavLink to="/archive" className={TAB}>
                Archive
              </NavLink>
            </nav>
            <ViewModeSwitch mode={mode} onChange={setMode} />
            <Link to="/notes/new" aria-label="New note" className="button-outline group/tip relative px-3 py-1.5">
              <SquarePen className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">New note</span>
              <span className="tooltip top-full mt-2">New note (N)</span>
            </Link>
          </div>
          <CaptureBox />
        </div>
      </div>

      <div className={`mx-auto ${MODE_WIDTH[mode]} transition-[max-width]`}>
        {items.isPending && <ItemListSkeleton mode={mode} />}
        {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
        {archived && items.isSuccess && all.length === 0 && (
          <EmptyState icon={Archive} title="Nothing archived">
            Archive what you want to keep out of the way: it waits here, and search still finds it.
          </EmptyState>
        )}
        {!archived && items.isSuccess && all.length === 0 && pending.length === 0 && (
          <EmptyState icon={Inbox} title="Inbox zero">
            Everything is sorted. Type above, paste with <kbd className="kbd">{MOD}</kbd>{' '}
            <kbd className="kbd">V</kbd> or drop files anywhere: it all lands here, to sort later.
          </EmptyState>
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

        {archived ? (
          <ItemList items={all} mode={mode} archived />
        ) : (
          <ItemList items={all} mode={mode} sortable={{}} />
        )}

        {items.hasNextPage && (
          <LoadMore loading={items.isFetchingNextPage} onClick={() => items.fetchNextPage()} />
        )}
      </div>
    </div>
  )
}
