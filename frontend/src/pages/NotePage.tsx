import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { itemKey, itemsKey, updateNoteBody, useItem, type Item } from '../items/api'
import { ApiError } from '../lib/api'
import { NoteEditor } from '../notes/NoteEditor'
import { NEW_NOTE, NoteSaver, localDrafts, type SaverState } from '../notes/saver'

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * `/notes/:id`, or `/notes/new` for a note that doesn't exist until it has
 * text. When a new note is saved the URL catches up with its id and the same
 * editor stays; opening any other note starts afresh.
 */
export function NotePage() {
  const { id = NEW_NOTE } = useParams()
  const [session, setSession] = useState({ key: id, created: null as string | null })
  if (id !== session.key && id !== session.created) setSession({ key: id, created: null })

  return (
    <NoteSession
      key={session.key}
      id={id}
      onCreated={(created) => setSession((current) => ({ ...current, created }))}
    />
  )
}

function NoteSession({ id, onCreated }: { id: string; onCreated: (id: string) => void }) {
  const isNew = id === NEW_NOTE
  // A note created in this session is already in the cache: no loading step.
  const item = useItem(isNew ? undefined : id)

  if (isNew) return <NoteWorkspace id={id} initial={null} onCreated={onCreated} />
  if (item.isPending) {
    return <Frame status={<span className="text-zinc-500">Loading…</span>} />
  }
  if (item.isError) {
    const missing = item.error instanceof ApiError && item.error.status === 404
    return (
      <Frame>
        <p role="alert" className="py-12 text-center text-zinc-500">
          {missing ? 'This note no longer exists.' : item.error.message}
        </p>
      </Frame>
    )
  }
  if (item.data.kind !== 'note') {
    return (
      <Frame>
        <p className="py-12 text-center text-zinc-500">Only notes can be edited here.</p>
      </Frame>
    )
  }
  return <NoteWorkspace id={id} initial={item.data} onCreated={onCreated} />
}

function NoteWorkspace({
  id,
  initial,
  onCreated,
}: {
  id: string
  initial: Item | null
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { capture, dismiss } = useCapturePipeline()
  // Null until the saver first reports: it may start from a restored draft.
  const [reported, setReported] = useState<SaverState<Item> | null>(null)

  const [saver] = useState(() => {
    const created = new NoteSaver<Item>(initial, {
      // New notes come in through the capture pipeline, like everything else.
      create: async (body) => {
        const [result] = await capture(
          { inputs: [{ kind: 'note', text: body }], skipped: [] },
          { undo: false },
        )
        if ('item' in result) return result.item
        dismiss(result.id)
        throw new Error(result.error)
      },
      update: updateNoteBody,
      onChange: setReported,
      onSaved: (item, isNew) => {
        queryClient.setQueryData(itemKey(item.id), item)
        // Lists refetch when shown again; the open note is already up to date.
        queryClient.invalidateQueries({
          queryKey: itemsKey,
          predicate: (query) => query.queryKey[1] !== 'detail',
        })
        if (isNew) {
          onCreated(item.id)
          navigate(`/notes/${item.id}`, { replace: true })
        }
      },
      drafts: localDrafts,
    })
    created.restoreDraft()
    return created
  })
  const state = reported ?? saver.snapshot

  useEffect(() => {
    saver.resume()
    const flushNow = () => saver.flush({ keepalive: true })
    const onVisibility = () => document.visibilityState === 'hidden' && flushNow()
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // Pending edits go out with keepalive on pagehide; warn only when they can't.
      if (['offline', 'error', 'conflict'].includes(saver.status)) event.preventDefault()
    }
    const onOnline = () => saver.retryNow()
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('online', onOnline)
      saver.dispose()
    }
  }, [saver])

  // Saved elsewhere (another tab, on focus): take it if nothing here is pending.
  const latest = useItem(id === NEW_NOTE ? undefined : id).data
  useEffect(() => {
    if (latest && latest.version !== saver.version && saver.status === 'saved') {
      saver.load(latest)
    }
  }, [latest, saver])

  return (
    <Frame
      status={
        <SaveIndicator state={state} isNew={!saver.noteId} onRetry={() => saver.retryNow()} />
      }
    >
      {state.status === 'conflict' && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950"
        >
          <span className="mr-auto">
            This note changed in another tab or device. Your text is kept here until you choose.
          </span>
          <button type="button" className={actionButton} onClick={() => saver.resolve('theirs')}>
            Load latest
          </button>
          <button type="button" className={actionButton} onClick={() => saver.resolve('mine')}>
            Keep mine
          </button>
        </div>
      )}
      <NoteEditor
        key={saver.generation}
        initial={saver.body}
        autoFocus
        onChange={(body) => saver.edit(body)}
        onSave={() => saver.flush()}
      />
    </Frame>
  )
}

function SaveIndicator({
  state,
  isNew,
  onRetry,
}: {
  state: SaverState
  isNew: boolean
  onRetry: () => void
}) {
  switch (state.status) {
    case 'saved':
      return isNew ? null : <span className="text-zinc-500">Saved</span>
    case 'unsaved':
    case 'saving':
      return <span className="text-zinc-500">Saving…</span>
    case 'offline':
      return (
        <span className="text-amber-700 dark:text-amber-400">Offline, kept on this device</span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-red-600">
          Couldn't save{state.error ? `: ${state.error}` : ''}
          <button type="button" className={actionButton} onClick={onRetry}>
            Retry
          </button>
        </span>
      )
    case 'conflict':
      return <span className="text-amber-700 dark:text-amber-400">Not saved, see above</span>
  }
}

function Frame({ status, children }: { status?: ReactNode; children?: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  // Back where we came from (the inbox, a collection), or the inbox on a fresh tab.
  const canGoBack = location.key !== 'default'

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-3 bg-zinc-50/90 py-3 text-sm backdrop-blur dark:bg-zinc-950/90">
        <Link
          to="/"
          className="rounded-md px-2 py-1 font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          onClick={(event) => {
            if (!canGoBack) return
            event.preventDefault()
            navigate(-1)
          }}
        >
          ← Back
        </Link>
        <div role="status" aria-live="polite" className="ml-auto text-xs">
          {status}
        </div>
      </div>
      {children}
    </div>
  )
}
