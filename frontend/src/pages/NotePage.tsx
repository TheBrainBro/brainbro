import {
  Archive,
  Check,
  CloudOff,
  FileDown,
  FileQuestion,
  FolderInput,
  Globe,
  History,
  Inbox,
  RotateCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { NoteHistoryDialog } from '../history/HistoryPanel'
import { CollectionPicker } from '../items/CollectionPicker'
import { OrganizeMenu, type OrganizeTriggerProps } from '../items/OrganizeMenu'
import { uploadNoteImage, useItem, useTriage, type Item } from '../items/api'
import { undoTriage, useUndoAction } from '../items/triage'
import { ApiError } from '../lib/api'
import { NoteEditor } from '../notes/NoteEditor'
import { NotePrint } from '../notes/NotePrint'
import { PublishDialog } from '../notes/PublishDialog'
import { Peers } from '../notes/Peers'
import { forgetLiveNote, useLiveNote, type LiveNote, type LiveStatus } from '../notes/live'
import { NEW_NOTE, type NoteSaver, type SaverState } from '../notes/saver'
import { useNewNoteSaver } from '../notes/useNewNoteSaver'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState } from '../ui/states'

/**
 * `/notes/:id`, or `/notes/new` for a note that doesn't exist until it has
 * text. When a new note is saved the URL catches up with its id and the same
 * page stays, going live; opening any other note starts afresh.
 */
export function NotePage() {
  const { id = NEW_NOTE } = useParams()
  const [session, setSession] = useState({ key: id, created: null as string | null })
  if (id !== session.key && id !== session.created) setSession({ key: id, created: null })

  return (
    <NoteSession
      key={session.key}
      id={id}
      isNew={session.key === NEW_NOTE}
      onCreated={(created) => setSession((current) => ({ ...current, created }))}
    />
  )
}

function NoteSession({
  id,
  isNew,
  onCreated,
}: {
  id: string
  isNew: boolean
  onCreated: (id: string) => void
}) {
  const item = useItem(isNew ? undefined : id)

  if (isNew) return <NewNote onCreated={onCreated} />
  if (item.isPending) {
    return (
      <Frame>
        <EditorSkeleton />
      </Frame>
    )
  }
  if (item.isError) {
    const missing = item.error instanceof ApiError && item.error.status === 404
    const inbox = (
      <Link to="/" className={missing ? 'button-primary' : 'button-secondary'}>
        Go to the inbox
      </Link>
    )
    return (
      <Frame>
        {missing ? (
          <EmptyState icon={FileQuestion} title="This note no longer exists" action={inbox}>
            It was deleted, maybe from another device.
          </EmptyState>
        ) : (
          <ErrorState
            error={item.error}
            title="Couldn't open this note"
            onRetry={() => item.refetch()}
            action={inbox}
          />
        )}
      </Frame>
    )
  }
  if (item.data.kind !== 'note') {
    return (
      <Frame>
        <EmptyState icon={FileQuestion} title="Only notes open here">
          Links, images and files open in the viewer, from the inbox or a collection.
        </EmptyState>
      </Frame>
    )
  }
  return <NoteWorkspace initial={item.data} />
}

/** A note that doesn't exist yet: created on its first text, then live. */
function NewNote({ onCreated }: { onCreated: (id: string) => void }) {
  const navigate = useNavigate()
  const { saver, state } = useNewNoteSaver({
    onCreated: (item) => {
      onCreated(item.id)
      navigate(`/notes/${item.id}`, { replace: true })
    },
  })
  return <NoteWorkspace initial={null} newNote={{ saver, state }} />
}

function NoteWorkspace({
  initial,
  newNote,
}: {
  initial: Item | null
  /** For a new note: its saver, until it is live. */
  newNote?: { saver: NoteSaver<Item>; state: SaverState }
}) {
  const noteId = initial?.id ?? newNote?.saver.noteId ?? null
  const latest = useItem(noteId ?? undefined).data
  const note = useLiveNote(noteId)
  const live = note.ready ? note.live : null
  const triage = useTriage()
  const { toast, confirm } = useFeedback()
  const undoAction = useUndoAction()
  const goBack = useGoBack()
  const [organizing, setOrganizing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [history, setHistory] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const current = latest ?? initial
  const status = current?.status
  const body = () => (live ? live.text.toString() : (newNote?.saver.body ?? ''))

  // The browser's own print would print the editor: ⌘P prints the note instead.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'p' || !(event.metaKey || event.ctrlKey) || event.altKey) return
      event.preventDefault()
      const text = live ? live.text.toString() : (newNote?.saver.body ?? '')
      if (text.trim()) setPrinting(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [live, newNote?.saver])

  function failed(error: Error) {
    toast({ message: error.message, tone: 'error' })
  }

  async function archive() {
    if (!noteId) return
    const action = status === 'archived' ? 'inbox' : 'archive'
    const before = latest ?? initial
    const undo = before ? undoTriage(action, [before]) : null
    try {
      await triage.mutateAsync({ ids: [noteId], action })
    } catch (error) {
      return failed(error as Error)
    }
    toast({
      message: action === 'archive' ? 'Archived the note' : 'Moved the note to the inbox',
      actions: undoAction(undo),
    })
    if (action === 'archive') goBack()
  }

  async function remove() {
    if (!noteId) return
    const confirmed = await confirm({
      title: 'Delete this note?',
      message: "It can't be undone.",
      confirm: 'Delete',
      danger: true,
    })
    if (!confirmed) return
    try {
      await triage.mutateAsync({ ids: [noteId], action: 'delete' })
    } catch (error) {
      return failed(error as Error)
    }
    forgetLiveNote(noteId)
    toast({ message: 'Deleted the note' })
    goBack()
  }

  return (
    <Frame
      status={
        newNote && !live ? (
          <SaveIndicator
            state={newNote.state}
            isNew={!noteId}
            onRetry={() => newNote.saver.retryNow()}
          />
        ) : (
          <span className="flex items-center gap-3">
            <Peers peers={note.peers} />
            <LiveIndicator status={note.status} />
          </span>
        )
      }
      actions={
        noteId && (
          <>
            <OrganizeMenu
              current={latest?.collections}
              onPick={(collection) =>
                triage.mutate(
                  { ids: [noteId], action: 'organize', collections: [collection.id] },
                  {
                    onSuccess: () => toast({ message: `Organized the note into ${collection.name}` }),
                    onError: failed,
                  },
                )
              }
              onRemove={(collection) =>
                triage.mutate(
                  { ids: [noteId], action: 'unorganize', collections: [collection.id] },
                  {
                    onSuccess: () =>
                      toast({
                        message: `Took the note out of ${collection.name}`,
                        actions: undoAction([
                          { ids: [noteId], action: 'organize', collections: [collection.id] },
                        ]),
                      }),
                    onError: failed,
                  },
                )
              }
              onMore={() => setOrganizing(true)}
              trigger={(props) => <Action icon={FolderInput} label="Organize" {...props} />}
            />
            {status === 'archived' ? (
              <Action icon={Inbox} label="To inbox" onClick={archive} />
            ) : (
              <Action icon={Archive} label="Archive" onClick={archive} />
            )}
            <Action
              icon={Globe}
              label={current?.published_at ? 'Public' : 'Publish'}
              onClick={() => setPublishing(true)}
            />
            <Action icon={History} label="History" onClick={() => setHistory(true)} />
            <Action icon={FileDown} label="Export PDF" onClick={() => setPrinting(true)} />
            <Action icon={Trash2} label="Delete" onClick={remove} />
          </>
        )
      }
    >
      {organizing && noteId && (
        <CollectionPicker
          count={1}
          onClose={() => setOrganizing(false)}
          onConfirm={(collections, names) =>
            triage.mutate(
              { ids: [noteId], action: 'organize', collections },
              {
                onSuccess: () => {
                  setOrganizing(false)
                  toast({ message: `Organized the note into ${names}` })
                },
                onError: failed,
              },
            )
          }
        />
      )}
      {history && current && (
        <NoteHistoryDialog
          note={current}
          // Restored: the editor shows it live, like an assistant's edit.
          onRestored={() => setHistory(false)}
          onClose={() => setHistory(false)}
        />
      )}
      {publishing && current && (
        <PublishDialog note={current} onClose={() => setPublishing(false)} />
      )}
      {printing && (
        <NotePrint
          body={body()}
          images={(latest ?? initial)?.images}
          links={(latest ?? initial)?.links}
          onDone={() => setPrinting(false)}
        />
      )}
      {live ? (
        <LiveNoteEditor
          live={live}
          handover={newNote?.saver.body}
          item={latest ?? initial}
          onUploadError={(message) => toast({ message, tone: 'error' })}
        />
      ) : newNote ? (
        <NoteEditor
          initial={newNote.saver.body}
          autoFocus
          onChange={(text) => newNote.saver.edit(text)}
          onSave={() => newNote.saver.flush()}
          uploadImage={uploadNoteImage}
          onUploadError={(message) => toast({ message, tone: 'error' })}
        />
      ) : (
        <EditorSkeleton />
      )}
    </Frame>
  )
}

/**
 * The note's editor once it is live. `handover`: what was typed into a new
 * note while it was being created, which goes into the live text first.
 */
function LiveNoteEditor({
  live,
  handover,
  item,
  onUploadError,
}: {
  live: LiveNote
  handover?: string
  item: Item | null | undefined
  onUploadError: (message: string) => void
}) {
  // Once, before the editor reads the text; doing it again changes nothing.
  useState(() => handover !== undefined && live.setText(handover))
  return (
    <NoteEditor
      live={live}
      autoFocus
      images={item?.images}
      links={item?.links}
      uploadImage={uploadNoteImage}
      onUploadError={onUploadError}
    />
  )
}

function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading note" className="space-y-3 pt-4">
      <div className="skeleton h-7 w-2/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
      <div className="skeleton h-4 w-3/5" />
    </div>
  )
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  switch (status) {
    case 'live':
      return (
        <span className="flex items-center gap-1 text-zinc-500">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      )
    case 'connecting':
      return <span className="text-zinc-500">Connecting…</span>
    case 'offline':
      return (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5" aria-hidden="true" />
          Offline, kept on this device
        </span>
      )
    case 'closed':
      return <span className="text-red-600 dark:text-red-400">Can't edit this note</span>
  }
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
      return isNew ? null : (
        <span className="flex items-center gap-1 text-zinc-500">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      )
    case 'unsaved':
    case 'saving':
      return <span className="text-zinc-500">Saving…</span>
    case 'offline':
      return (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5" aria-hidden="true" />
          Offline, kept on this device
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          Couldn't save{state.error ? `: ${state.error}` : ''}
          <button type="button" className="button-ghost" onClick={onRetry}>
            <RotateCw className="size-3.5" aria-hidden="true" />
            Retry
          </button>
        </span>
      )
    case 'conflict':
      // Only saves of existing text conflict, and new notes have none.
      return null
  }
}

/** Back where we came from (the inbox, a collection), or the inbox on a fresh tab. */
function useGoBack() {
  const location = useLocation()
  const navigate = useNavigate()
  const canGoBack = location.key !== 'default'
  return () => (canGoBack ? navigate(-1) : navigate('/'))
}

function Frame({
  status,
  actions,
  children,
}: {
  status?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const goBack = useGoBack()

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-3 bg-zinc-50/90 py-3 text-sm backdrop-blur dark:bg-zinc-950/90">
        <BackLink
          to="/"
          label="Back"
          onClick={(event) => {
            event.preventDefault()
            goBack()
          }}
        />
        <div role="status" aria-live="polite" className="ml-auto text-xs">
          {status}
        </div>
        {actions && <div className="flex gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** An action in the note's bar: icon and word, the icon alone on phones. */
function Action({
  icon: Icon,
  label,
  ...props
}: { icon: LucideIcon; label: string; onClick: () => void } & Partial<OrganizeTriggerProps>) {
  return (
    <button type="button" aria-label={label} className="button-ghost group/tip relative" {...props}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="tooltip top-full mt-2 sm:hidden">{label}</span>
    </button>
  )
}
