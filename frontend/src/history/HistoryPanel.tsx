import { useQueryClient } from '@tanstack/react-query'
import { History, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'

import { boardKey, boardsKey, seedItems, type Board } from '../boards/api'
import { itemKey, itemsKey, type Item } from '../items/api'
import { itemLabel } from '../items/label'
import { LoadMore } from '../items/LoadMore'
import { Markdown } from '../items/Markdown'
import { timeAgo } from '../lib/time'
import { useFeedback } from '../ui/feedback'
import {
  restoreBoard,
  restoreNote,
  revisionAuthor,
  useRevision,
  useRevisions,
  type HistoryTarget,
  type Revision,
} from './api'
import { aroundChanges, boardChanges, textDiff, type BoardChange } from './diff'

const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

function when(iso: string) {
  return fullDate.format(new Date(iso))
}

/**
 * The revisions of a note or a board, newest (what it holds now) first, and
 * the one picked. Starts on the one before the current, if there is one.
 */
function useHistory(target: HistoryTarget, version: string | number) {
  const revisions = useRevisions(target, version)
  const all = revisions.data?.pages.flatMap((page) => page.results) ?? []
  const [picked, setPicked] = useState<string | null>(null)
  const selected = all.find((revision) => revision.id === picked) ?? all[1] ?? all[0]
  return { revisions, all, current: all[0], selected, select: setPicked }
}

function RevisionList({
  history,
  className = '',
}: {
  history: ReturnType<typeof useHistory>
  className?: string
}) {
  const { revisions, all, current, selected, select } = history
  if (revisions.isPending) {
    return (
      <p className="p-4 text-sm text-zinc-500" role="status">
        Loading history…
      </p>
    )
  }
  if (revisions.isError) {
    return (
      <p className="p-4 text-sm text-red-600 dark:text-red-400" role="alert">
        Couldn't load the history. {revisions.error.message}
      </p>
    )
  }
  return (
    <div className={`overflow-y-auto p-2 ${className}`}>
      <ol aria-label="Revisions" className="space-y-0.5">
        {all.map((revision) => (
          <li key={revision.id}>
            <button
              type="button"
              aria-current={revision === selected ? 'true' : undefined}
              className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-zinc-100 aria-[current]:bg-accent-50 dark:hover:bg-zinc-800 dark:aria-[current]:bg-accent-500/15"
              onClick={() => select(revision.id)}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">{revisionAuthor(revision)}</span>
                <time
                  dateTime={revision.updated_at}
                  title={when(revision.updated_at)}
                  className="shrink-0 text-xs text-zinc-500"
                >
                  {timeAgo(revision.updated_at)}
                </time>
              </span>
              <RevisionTags revision={revision} current={revision === current} />
            </button>
          </li>
        ))}
      </ol>
      {revisions.hasNextPage && (
        <LoadMore loading={revisions.isFetchingNextPage} onClick={() => revisions.fetchNextPage()} />
      )}
    </div>
  )
}

function RevisionTags({ revision, current }: { revision: Revision; current: boolean }) {
  const notes = [
    current && 'Current version',
    revision.restored_from_at && `Restored the version from ${when(revision.restored_from_at)}`,
  ].filter(Boolean)
  if (!notes.length) return null
  return <span className="block text-xs text-zinc-500">{notes.join(' · ')}</span>
}

function RestoreButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="button-outline px-3 py-1.5" disabled={busy} onClick={onClick}>
      {busy ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <RotateCcw className="size-4" aria-hidden="true" />
      )}
      Restore this version
    </button>
  )
}

/** Asks first, restores, and says how it went. Resolves to what the server returned. */
function useRestore<T>(restore: (id: string) => Promise<T>, what: string) {
  const { confirm, toast } = useFeedback()
  const [busy, setBusy] = useState(false)

  return {
    busy,
    async run(revision: Revision, onRestored: (result: T) => void) {
      const confirmed = await confirm({
        title: 'Restore this version?',
        message: `The ${what} goes back to how it was ${timeAgo(revision.updated_at)}. What it holds now stays in its history.`,
        confirm: 'Restore',
      })
      if (!confirmed) return
      setBusy(true)
      try {
        onRestored(await restore(revision.id))
        toast({ message: `Restored the version from ${when(revision.updated_at)}` })
      } catch (error) {
        toast({ message: (error as Error).message, tone: 'error' })
      } finally {
        setBusy(false)
      }
    },
  }
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <History className="size-4 text-zinc-500" aria-hidden="true" />
      <h2 className="flex-1 text-sm font-semibold">{title}</h2>
      <button type="button" aria-label="Close history" className="button-icon size-8" onClick={onClose}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * A note's history, in the viewer: its revisions, and the one picked as it
 * was or as what changed since, to restore.
 */
export function NoteHistory({
  note,
  onRestored,
  onClose,
}: {
  note: Item
  onRestored: (note: Item) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const target = { item: note.id }
  const history = useHistory(target, note.version)
  const { current, selected } = history
  const shown = useRevision(target, selected)
  const now = useRevision(target, current)
  const [view, setView] = useState<'changes' | 'then'>('changes')
  const restore = useRestore(restoreNote, 'note')

  return (
    <div className="flex size-full max-w-6xl flex-col gap-3 md:flex-row">
      <section aria-label="Version" className="viewer-sheet flex min-h-0 flex-1 flex-col p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <div role="tablist" className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {(
              [
                ['changes', 'Changes since'],
                ['then', 'As it was'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                className="rounded-md px-3 py-1 text-sm text-zinc-500 transition aria-selected:bg-white aria-selected:font-medium aria-selected:text-zinc-900 aria-selected:shadow-xs dark:aria-selected:bg-zinc-700 dark:aria-selected:text-zinc-100"
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          {selected && selected !== current && (
            <RestoreButton
              busy={restore.busy}
              onClick={() =>
                restore.run(selected, (restored) => {
                  queryClient.setQueryData(itemKey(restored.id), restored)
                  queryClient.invalidateQueries({ queryKey: itemsKey })
                  onRestored(restored)
                })
              }
            />
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
          {shown.data && now.data ? (
            view === 'then' ? (
              <>
                {shown.data.title && <h1 className="mb-3 text-2xl font-semibold">{shown.data.title}</h1>}
                <Markdown id={`revision-${shown.data.id}`} fill images={note.images} links={note.links}>
                  {shown.data.body}
                </Markdown>
              </>
            ) : (
              <NoteChanges
                before={shown.data}
                after={now.data}
                isCurrent={selected === current}
              />
            )
          ) : shown.isError || now.isError ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              Couldn't load this version.
            </p>
          ) : (
            <p role="status" className="text-sm text-zinc-500">
              Loading…
            </p>
          )}
        </div>
      </section>
      <aside
        aria-label="History"
        className="flex max-h-72 w-full shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl md:max-h-full md:w-80 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <PanelHeader title="History" onClose={onClose} />
        <RevisionList history={history} className="min-h-0 flex-1" />
      </aside>
    </div>
  )
}

const LINE_STYLE = {
  added: 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  removed: 'bg-red-50 text-red-900 line-through decoration-red-400/60 dark:bg-red-500/15 dark:text-red-200',
  same: 'text-zinc-600 dark:text-zinc-400',
}
const LINE_MARK = { added: '+', removed: '−', same: ' ' }

/** What changed from `before` (the revision picked) to `after` (the note now). */
function NoteChanges({
  before,
  after,
  isCurrent,
}: {
  before: { title: string; body: string }
  after: { title: string; body: string }
  isCurrent: boolean
}) {
  if (isCurrent) return <p className="text-sm text-zinc-500">This is what the note holds now.</p>
  const lines = aroundChanges(textDiff(before.body, after.body))
  const renamed = before.title !== after.title
  if (!renamed && !lines.some((line) => line.type === 'added' || line.type === 'removed')) {
    return <p className="text-sm text-zinc-500">Nothing changed since this version.</p>
  }
  return (
    <div className="space-y-3">
      {renamed && (
        <p className="text-sm">
          Title: <del className="text-red-700 dark:text-red-300">{before.title || 'Untitled'}</del>{' '}
          → <ins className="text-emerald-700 no-underline dark:text-emerald-300">{after.title || 'Untitled'}</ins>
        </p>
      )}
      <pre aria-label="Changes" className="overflow-x-auto rounded-lg border border-zinc-200 font-mono text-[13px] leading-6 dark:border-zinc-800">
        {lines.map((line, index) =>
          line.type === 'gap' ? (
            <div key={index} className="bg-zinc-50 px-3 text-xs leading-7 text-zinc-500 dark:bg-zinc-800/60">
              {line.count === 1 ? '1 unchanged line' : `${line.count} unchanged lines`}
            </div>
          ) : (
            <div key={index} className={`flex px-3 whitespace-pre-wrap ${LINE_STYLE[line.type]}`}>
              <span aria-hidden="true" className="w-4 shrink-0 select-none">
                {LINE_MARK[line.type]}
              </span>
              <span className="min-w-0 flex-1">
                {line.type !== 'same' && <span className="sr-only">{line.type}: </span>}
                {line.text || ' '}
              </span>
            </div>
          ),
        )}
      </pre>
    </div>
  )
}

const CHANGE_STYLE = {
  added: 'text-emerald-700 dark:text-emerald-300',
  removed: 'text-red-700 dark:text-red-300',
  changed: 'text-zinc-700 dark:text-zinc-300',
}
const CHANGE_MARK = { added: '+', removed: '−', changed: '•' }

/**
 * A board's history, beside its canvas: its revisions and, for the one
 * picked, what changed on the board since, to restore.
 */
export function BoardHistory({ board, onClose }: { board: Board; onClose: () => void }) {
  const queryClient = useQueryClient()
  const target = { board: board.id }
  const history = useHistory(target, board.revision)
  const { current, selected } = history
  const shown = useRevision(target, selected)
  const now = useRevision(target, current)
  const restore = useRestore(restoreBoard, 'board')

  function label(itemId: string) {
    const item =
      shown.data?.items?.find((candidate) => candidate.id === itemId) ??
      board.items.find((candidate) => candidate.id === itemId)
    return item ? `“${itemLabel(item)}”` : 'an item deleted since'
  }

  let changes: BoardChange[] | null = null
  if (shown.data?.layout && now.data?.layout) {
    changes = boardChanges(
      { title: shown.data.title, layout: shown.data.layout },
      { title: now.data.title, layout: now.data.layout },
      label,
    )
  }

  return (
    <aside
      aria-label="History"
      className="absolute inset-y-0 right-0 z-10 flex w-96 max-w-full flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
    >
      <PanelHeader title="Board history" onClose={onClose} />
      <RevisionList history={history} className="min-h-0 flex-1" />
      {selected && (
        <section
          aria-label="Changes since this version"
          className="max-h-[45%] overflow-y-auto border-t border-zinc-200 p-4 dark:border-zinc-800"
        >
          {selected === current ? (
            <p className="text-sm text-zinc-500">This is what the board holds now.</p>
          ) : changes === null ? (
            <p role="status" className="text-sm text-zinc-500">
              Loading…
            </p>
          ) : (
            <>
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Changes since this version
              </h3>
              {changes.length ? (
                <ul className="mb-4 space-y-1 text-sm">
                  {changes.map((change, index) => (
                    <li key={index} className={`flex gap-2 ${CHANGE_STYLE[change.type]}`}>
                      <span aria-hidden="true" className="w-3 shrink-0">
                        {CHANGE_MARK[change.type]}
                      </span>
                      {change.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-zinc-500">Nothing changed since this version.</p>
              )}
              <RestoreButton
                busy={restore.busy}
                onClick={() =>
                  restore.run(selected, (restored) => {
                    seedItems(queryClient, restored.items)
                    // The canvas takes it as a save made elsewhere.
                    queryClient.setQueryData(boardKey(board.id), restored)
                    queryClient.invalidateQueries({ queryKey: boardsKey, exact: true })
                    // Cards put back took items out of the inbox, and the other way round.
                    queryClient.invalidateQueries({
                      queryKey: itemsKey,
                      predicate: (query) => query.queryKey[1] !== 'detail',
                    })
                  })
                }
              />
            </>
          )}
        </section>
      )}
    </aside>
  )
}
