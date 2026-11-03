import { Archive, Bot, Inbox, SquarePen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { rich, useT } from '../i18n/i18n'
import { CaptureBox } from '../items/CaptureBox'
import { ItemList } from '../items/ItemList'
import { ItemListSkeleton } from '../items/ItemListSkeleton'
import { useHasItems, useItems } from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { LoadMore } from '../items/LoadMore'
import { OriginFilter, type OriginFilters } from '../items/OriginFilter'
import { ViewModeSwitch } from '../items/ViewModeSwitch'
import { isEditable } from '../lib/dom'
import { MOD } from '../lib/keys'
import { useTutorial } from '../onboarding/tutorial'
import { EmptyState, ErrorState } from '../ui/states'

const TAB =
  'rounded-md px-1 text-2xl font-semibold transition aria-[current=page]:text-zinc-900 dark:aria-[current=page]:text-zinc-100 text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400'

/** The inbox, or with `archived` what was archived, to bring back or delete. */
export function InboxPage({ archived = false }: { archived?: boolean }) {
  const t = useT()
  const [origin, setOrigin] = useState<OriginFilters>({})
  const filtered = Boolean(origin.origin || origin.app)
  const items = useItems({ status: archived ? 'archived' : 'inbox', ...origin })
  const all = items.data?.pages.flatMap((page) => page.results) ?? []
  const captures = useCapturePipeline().pending.filter((entry) => !entry.collection)
  // Captures land in the inbox: that is where they show, unless it is filtered.
  const pending = archived || filtered ? [] : captures
  const navigate = useNavigate()
  const tutorial = useTutorial()
  const [mode, setMode] = useViewMode('inbox')
  const nothing = items.isSuccess && all.length === 0 && pending.length === 0
  const empty = !archived && !filtered && nothing
  // Nothing captured yet, or everything sorted: the empty inbox says which.
  const hasItems = useHasItems(empty)
  const paste = (
    <>
      <kbd className="kbd">{MOD}</kbd> <kbd className="kbd">V</kbd>
    </>
  )

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
            <h1 className="sr-only">{archived ? t('inbox.archive') : t('inbox.inbox')}</h1>
            <nav aria-label={t('inbox.tabs')} className="mr-auto flex items-baseline gap-3">
              <NavLink to="/" end className={TAB}>
                {t('inbox.inbox')}
              </NavLink>
              <NavLink to="/archive" className={TAB}>
                {t('inbox.archive')}
              </NavLink>
            </nav>
            <OriginFilter value={origin} onChange={setOrigin} />
            <ViewModeSwitch mode={mode} onChange={setMode} />
            <Link
              to="/notes/new"
              data-tutorial="new-note"
              aria-label={t('inbox.newNote')}
              className="button-outline group/tip relative px-3 py-1.5"
              onClick={() => {
                if (tutorial.step === 'newNoteNav') tutorial.complete('newNoteNav')
              }}
            >
              <SquarePen className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('inbox.newNote')}</span>
              <span className="tooltip top-full mt-2">{t('inbox.newNoteKey')}</span>
            </Link>
          </div>
          <CaptureBox />
        </div>
      </div>

      <div className={`mx-auto ${MODE_WIDTH[mode]} transition-[max-width]`}>
        {items.isPending && <ItemListSkeleton mode={mode} />}
        {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
        {filtered && nothing && (
          <EmptyState icon={Bot} title={t('inbox.nothingHere')}>
            {archived ? t('inbox.noArchivedMatch') : t('inbox.noInboxMatch')}
          </EmptyState>
        )}
        {archived && !filtered && nothing && (
          <EmptyState icon={Archive} title={t('inbox.nothingArchived')}>
            {t('inbox.archiveHint')}
          </EmptyState>
        )}
        {empty && hasItems.isSuccess && (
          <EmptyState icon={Inbox} title={t('inbox.zero')}>
            {rich(hasItems.data ? 'inbox.sorted' : 'inbox.first', { paste })}
          </EmptyState>
        )}

        {pending.length > 0 && (
          <ul className="mb-3 space-y-3" aria-label={t('inbox.capturing')}>
            {pending.map((entry) => (
              <li key={entry.id}>
                <PendingCard entry={entry} />
              </li>
            ))}
          </ul>
        )}

        {archived ? (
          <ItemList items={all} mode={mode} archived animatePresence={items.isSuccess} />
        ) : (
          // A filtered list leaves items out: no sorting by hand in it.
          <ItemList
            items={all}
            mode={mode}
            sortable={filtered ? undefined : {}}
            animatePresence={items.isSuccess}
          />
        )}

        {items.hasNextPage && (
          <LoadMore loading={items.isFetchingNextPage} onClick={() => items.fetchNextPage()} />
        )}
      </div>
    </div>
  )
}
