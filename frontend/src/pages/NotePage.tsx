import {
  Archive,
  Check,
  CloudOff,
  Ellipsis,
  FileDown,
  FileQuestion,
  FolderInput,
  History,
  Inbox,
  RotateCw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'

import { NoteHistoryDialog } from '../history/HistoryPanel'
import { useT } from '../i18n/i18n'
import { CollectionPicker } from '../items/CollectionPicker'
import { OrganizeMenu, type OrganizeTriggerProps } from '../items/OrganizeMenu'
import {
  uploadNoteImage,
  useItem,
  useSaveNoteTitle,
  useTriage,
  type Item,
} from '../items/api'
import { undoTriage, useUndoAction } from '../items/triage'
import { ApiError } from '../lib/api'
import { NoteEditor } from '../notes/NoteEditor'
import { NotePrint } from '../notes/NotePrint'
import { PageSettingsDialog } from '../notes/PageSettingsDialog'
import { Peers } from '../notes/Peers'
import { VisibilityMenu } from '../notes/VisibilityMenu'
import { forgetLiveNote, useLiveNote, type LiveNote, type LiveStatus } from '../notes/live'
import { NEW_NOTE, type NoteSaver, type SaverState } from '../notes/saver'
import { useNewNoteSaver } from '../notes/useNewNoteSaver'
import { BackLink } from '../ui/BackLink'
import { Dropdown } from '../ui/Dropdown'
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
  const t = useT()
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
        {t('note.toInbox')}
      </Link>
    )
    return (
      <Frame>
        {missing ? (
          <EmptyState icon={FileQuestion} title={t('note.gone')} action={inbox}>
            {t('note.goneHint')}
          </EmptyState>
        ) : (
          <ErrorState
            error={item.error}
            title={t('note.couldNotOpen')}
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
        <EmptyState icon={FileQuestion} title={t('note.onlyNotes')}>
          {t('note.onlyNotesHint')}
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
  return (
    <NoteWorkspace
      initial={null}
      newNote={{ saver, state }}
    />
  )
}

function NoteWorkspace({
  initial,
  newNote,
}: {
  initial: Item | null
  /** For a new note: its saver, until it is live. */
  newNote?: { saver: NoteSaver<Item>; state: SaverState }
}) {
  const t = useT()
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
  const [pageSettings, setPageSettings] = useState(false)

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
      message: action === 'archive' ? t('note.archived') : t('note.movedToInbox'),
      actions: undoAction(undo),
    })
    if (action === 'archive') goBack()
  }

  async function remove() {
    if (!noteId) return
    const confirmed = await confirm({
      title: t('note.deleteTitle'),
      message: t('itemList.cantUndo'),
      confirm: t('common.delete'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await triage.mutateAsync({ ids: [noteId], action: 'delete' })
    } catch (error) {
      return failed(error as Error)
    }
    forgetLiveNote(noteId)
    toast({ message: t('note.deleted') })
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
                    onSuccess: () =>
                      toast({ message: t('note.organizedInto', { name: collection.name }) }),
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
                        message: t('note.tookOut', { name: collection.name }),
                        actions: undoAction([
                          { ids: [noteId], action: 'organize', collections: [collection.id] },
                        ]),
                      }),
                    onError: failed,
                  },
                )
              }
              onMore={() => setOrganizing(true)}
              trigger={(props) => <Action icon={FolderInput} label={t('note.organize')} {...props} />}
            />
            {current && (
              <VisibilityMenu note={current} onSettings={() => setPageSettings(true)} />
            )}
            <Dropdown
              label={t('note.more')}
              trigger={(props) => (
                <button type="button" aria-label={t('note.more')} className="button-ghost" {...props}>
                  <Ellipsis className="size-4" aria-hidden="true" />
                </button>
              )}
            >
              {(close) => {
                const item = (icon: LucideIcon, label: string, run: () => void, danger = false) => {
                  const Icon = icon
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className={`menu-item ${danger ? 'text-red-600 dark:text-red-400' : ''}`}
                      onClick={() => {
                        close()
                        run()
                      }}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </button>
                  )
                }
                return (
                  <>
                    {status === 'archived'
                      ? item(Inbox, t('note.moveToInbox'), archive)
                      : item(Archive, t('note.archive'), archive)}
                    {item(History, t('note.history'), () => setHistory(true))}
                    {item(FileDown, t('note.exportPdf'), () => setPrinting(true))}
                    <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                    {item(Trash2, t('common.delete'), remove, true)}
                  </>
                )
              }}
            </Dropdown>
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
                  toast({ message: t('note.organizedInto', { name: names }) })
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
      {pageSettings && current && (
        <PageSettingsDialog note={current} onClose={() => setPageSettings(false)} />
      )}
      {printing && (
        <NotePrint
          body={body()}
          images={(latest ?? initial)?.images}
          links={(latest ?? initial)?.links}
          onDone={() => setPrinting(false)}
        />
      )}
      {current?.title && <NoteTitleInput item={current} onError={failed} />}
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
          firstLineIsTitle
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

function NoteTitleInput({ item, onError }: { item: Item; onError: (error: Error) => void }) {
  const t = useT()
  const save = useSaveNoteTitle()
  const [draft, setDraft] = useState({ version: item.version, title: item.title })
  const title = draft.version === item.version ? draft.title : item.title

  function commit() {
    const next = title.trim()
    if (next === item.title) {
      setDraft({ version: item.version, title: item.title })
      return
    }
    save.mutate(
      { item, title: next },
      {
        onSuccess: (saved) => setDraft({ version: saved.version, title: saved.title }),
        onError: (error) => {
          setDraft({ version: item.version, title: item.title })
          onError(error)
        },
      },
    )
  }

  return (
    <input
      aria-label={t('note.titleLabel')}
      className="mb-2 w-full border-0 border-b border-transparent bg-transparent px-0 py-1 text-2xl font-semibold outline-none placeholder:text-zinc-400 focus:border-zinc-300 dark:focus:border-zinc-700"
      maxLength={500}
      placeholder={t('note.titlePlaceholder')}
      value={title}
      disabled={save.isPending}
      onChange={(event) => setDraft({ version: item.version, title: event.target.value })}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft({ version: item.version, title: item.title })
          event.currentTarget.blur()
        }
      }}
    />
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
      firstLineIsTitle={!item?.title}
      images={item?.images}
      links={item?.links}
      uploadImage={uploadNoteImage}
      onUploadError={onUploadError}
    />
  )
}

function EditorSkeleton() {
  const t = useT()
  return (
    <div role="status" aria-label={t('note.loading')} className="space-y-3 pt-4">
      <div className="skeleton h-7 w-2/3" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-5/6" />
      <div className="skeleton h-4 w-3/5" />
    </div>
  )
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  const t = useT()
  switch (status) {
    case 'live':
      return (
        <span className="flex items-center gap-1 text-zinc-500">
          <Check className="size-3.5" aria-hidden="true" />
          {t('note.saved')}
        </span>
      )
    case 'connecting':
      return <span className="text-zinc-500">{t('note.connecting')}</span>
    case 'offline':
      return (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5" aria-hidden="true" />
          {t('note.offline')}
        </span>
      )
    case 'closed':
      return <span className="text-red-600 dark:text-red-400">{t('note.closed')}</span>
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
  const t = useT()
  switch (state.status) {
    case 'saved':
      return isNew ? null : (
        <span className="flex items-center gap-1 text-zinc-500">
          <Check className="size-3.5" aria-hidden="true" />
          {t('note.saved')}
        </span>
      )
    case 'unsaved':
    case 'saving':
      return <span className="text-zinc-500">{t('note.saving')}</span>
    case 'offline':
      return (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <CloudOff className="size-3.5" aria-hidden="true" />
          {t('note.offline')}
        </span>
      )
    case 'error':
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          {state.error ? t('note.saveFailedWhy', { error: state.error }) : t('note.saveFailed')}
          <button type="button" className="button-ghost" onClick={onRetry}>
            <RotateCw className="size-3.5" aria-hidden="true" />
            {t('note.retry')}
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
  const t = useT()
  const goBack = useGoBack()

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16">
      <div className="sticky top-0 z-10 flex min-h-14 items-center gap-3 bg-zinc-50/90 py-3 text-sm backdrop-blur dark:bg-zinc-950/90">
        <BackLink
          to="/"
          label={t('note.back')}
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
