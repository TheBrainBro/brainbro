import {
  Archive,
  Check,
  CircleAlert,
  CloudOff,
  FileQuestion,
  FolderInput,
  Inbox,
  RotateCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { CollectionPicker } from '../items/CollectionPicker'
import { OrganizeMenu, type OrganizeTriggerProps } from '../items/OrganizeMenu'
import { uploadNoteImage, useItem, useTriage, type Item } from '../items/api'
import { undoTriage, useUndoAction } from '../items/triage'
import { ApiError } from '../lib/api'
import { NoteEditor } from '../notes/NoteEditor'
import { NEW_NOTE, type SaverState } from '../notes/saver'
import { useNoteSaver } from '../notes/useNoteSaver'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState } from '../ui/states'

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

  if (isNew) return <NoteWorkspace initial={null} onCreated={onCreated} />
  if (item.isPending) {
    return (
      <Frame>
        <div role="status" aria-label="Loading note" className="space-y-3 pt-4">
          <div className="skeleton h-7 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-4 w-3/5" />
        </div>
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
  return <NoteWorkspace initial={item.data} onCreated={onCreated} />
}

function NoteWorkspace({
  initial,
  onCreated,
}: {
  initial: Item | null
  onCreated: (id: string) => void
}) {
  const navigate = useNavigate()
  const { saver, state, latest } = useNoteSaver(initial, {
    onCreated: (item) => {
      onCreated(item.id)
      navigate(`/notes/${item.id}`, { replace: true })
    },
  })
  const triage = useTriage()
  const { toast, confirm } = useFeedback()
  const undoAction = useUndoAction()
  const goBack = useGoBack()
  const [organizing, setOrganizing] = useState(false)

  const noteId = saver.noteId
  const status = latest?.status ?? initial?.status

  function failed(error: Error) {
    toast({ message: error.message, tone: 'error' })
  }

  async function archive() {
    if (!noteId) return
    // Triage doesn't touch the text, so a save still in flight is fine.
    saver.flush()
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
    saver.discard()
    try {
      await triage.mutateAsync({ ids: [noteId], action: 'delete' })
    } catch (error) {
      return failed(error as Error)
    }
    toast({ message: 'Deleted the note' })
    goBack()
  }

  return (
    <Frame
      status={<SaveIndicator state={state} isNew={!noteId} onRetry={() => saver.retryNow()} />}
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
              onMore={() => setOrganizing(true)}
              trigger={(props) => <Action icon={FolderInput} label="Organize" {...props} />}
            />
            {status === 'archived' ? (
              <Action icon={Inbox} label="To inbox" onClick={archive} />
            ) : (
              <Action icon={Archive} label="Archive" onClick={archive} />
            )}
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
      {state.status === 'conflict' && (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950"
        >
          <CircleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="mr-auto">
            This note changed in another tab or device. Your text is kept here until you choose.
          </span>
          <button type="button" className="button-ghost" onClick={() => saver.resolve('theirs')}>
            Load latest
          </button>
          <button type="button" className="button-ghost" onClick={() => saver.resolve('mine')}>
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
        images={(latest ?? initial)?.images}
        uploadImage={uploadNoteImage}
        onUploadError={(message) => toast({ message, tone: 'error' })}
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
      return <span className="text-amber-700 dark:text-amber-400">Not saved, see above</span>
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
    <button type="button" aria-label={label} className="button-ghost group relative" {...props}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="tooltip top-full mt-2 sm:hidden">{label}</span>
    </button>
  )
}
