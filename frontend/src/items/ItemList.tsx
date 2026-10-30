import { Archive, FolderInput, Images, Inbox, Pencil, Trash2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { isEditable } from '../lib/dom'
import { useFeedback } from '../ui/feedback'
import { useViewer } from '../viewer/context'
import { CollectionPicker } from './CollectionPicker'
import { ItemCard } from './ItemCard'
import { ItemRow, ItemTile } from './ItemTile'
import { OrganizeMenu } from './OrganizeMenu'
import type { ViewMode } from './viewMode'
import {
  useMakeAlbum,
  useSetAlbumItems,
  useTriage,
  type Collection,
  type Item,
  type TriageAction,
} from './api'
import { triageMessage, undoTriage, useUndoAction } from './triage'

const LAYOUT: Record<ViewMode, string> = {
  cards: 'space-y-3',
  list: 'space-y-1.5',
  grid: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
  // Columns, Pinterest-like: each card keeps its own height.
  masonry: 'columns-1 gap-4 sm:columns-2 lg:columns-3',
}

/**
 * Items with triage: per-card actions, multi-select and keyboard shortcuts
 * (j/k move, Enter open a note, x select, o organize, e archive, # delete,
 * Esc clear).
 */
export function ItemList({
  items,
  backToInbox = false,
  mode = 'cards',
}: {
  items: Item[]
  backToInbox?: boolean
  mode?: ViewMode
}) {
  const triage = useTriage()
  const makeAlbum = useMakeAlbum()
  const setAlbumItems = useSetAlbumItems()
  const navigate = useNavigate()
  const viewer = useViewer()
  const { toast, confirm } = useFeedback()
  const undoAction = useUndoAction()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [organizing, setOrganizing] = useState<string[] | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  // Forget selections of items that left this list (triaged elsewhere).
  const visibleSelection = items.filter((item) => selected.has(item.id)).map((item) => item.id)

  function failed(error: Error) {
    toast({ message: error.message, tone: 'error' })
  }

  async function run(ids: string[], action: TriageAction) {
    if (!ids.length) return
    if (action === 'organize') {
      setOrganizing(ids)
      return
    }
    if (action === 'delete') {
      const confirmed = await confirm({
        title: ids.length === 1 ? 'Delete this item?' : `Delete ${ids.length} items?`,
        message: "It can't be undone.",
        confirm: 'Delete',
        danger: true,
      })
      if (!confirmed) return
    }
    const undo = undoTriage(
      action,
      items.filter((item) => ids.includes(item.id)),
    )
    triage.mutate(
      { ids, action },
      {
        onSuccess: () => {
          setSelected(new Set())
          toast({
            message: triageMessage(action, ids.length),
            actions: undoAction(undo),
          })
        },
        onError: failed,
      },
    )
  }

  /** One click from the organize menu. */
  function organizeInto(ids: string[], collection: Collection) {
    triage.mutate(
      { ids, action: 'organize', collections: [collection.id] },
      {
        onSuccess: () => {
          setSelected(new Set())
          toast({ message: triageMessage('organize', ids.length, collection.name) })
        },
        onError: failed,
      },
    )
  }

  /** Notes open in the editor; anything else in the viewer, stepping through this list. */
  function open(item: Item | undefined) {
    if (!item) return
    if (item.kind === 'note') navigate(`/notes/${item.id}`)
    else viewer.open(items, items.indexOf(item))
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (organizing || isEditable(event.target) || event.metaKey || event.ctrlKey) return
    const index = items.findIndex((item) => item.id === focused)
    const targets = visibleSelection.length ? visibleSelection : focused ? [focused] : []

    const move = (delta: number) => {
      const next = items[Math.min(Math.max(index + delta, 0), items.length - 1)]
      if (!next) return
      setFocused(next.id)
      cards.current.get(next.id)?.scrollIntoView({ block: 'nearest' })
    }
    const handlers: Record<string, () => void> = {
      j: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      ArrowUp: () => move(-1),
      Enter: () => open(items[index]),
      x: () => focused && toggle(focused),
      o: () => run(targets, 'organize'),
      e: () => run(targets, 'archive'),
      '#': () => run(targets, 'delete'),
      Escape: () => setSelected(new Set()),
    }
    const handler = handlers[event.key]
    if (handler) {
      event.preventDefault()
      handler()
    }
  })

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Images selected together can become an album; with one album among
   * them, they join it.
   */
  function albumAction(ids: string[]) {
    const chosen = items.filter((item) => ids.includes(item.id))
    const albums = chosen.filter((item) => item.kind === 'album')
    const images = chosen.filter((item) => item.kind === 'image')
    if (albums.length > 1 || images.length + albums.length !== chosen.length) return null
    const done = { onSuccess: () => setSelected(new Set()), onError: failed }
    if (albums.length === 1 && images.length > 0) {
      const album = albums[0]
      const inside = (album.album_items ?? []).map((image) => image.id)
      return (
        <button
          type="button"
          className="button-ghost"
          onClick={() =>
            setAlbumItems.mutate(
              { album: album.id, ids: [...inside, ...images.map((image) => image.id)] },
              {
                ...done,
                onSuccess: () => {
                  done.onSuccess()
                  toast({ message: `Added ${images.length === 1 ? '1 image' : `${images.length} images`} to the album` })
                },
              },
            )
          }
        >
          <Images className="size-3.5" aria-hidden="true" />
          Add to album
        </button>
      )
    }
    if (albums.length > 0 || images.length < 2) return null
    return (
      <button
        type="button"
        className="button-ghost"
        onClick={() =>
          makeAlbum.mutate(
            { ids: images.map((image) => image.id) },
            {
              ...done,
              onSuccess: () => {
                done.onSuccess()
                toast({ message: `Made an album of ${images.length} images` })
              },
            },
          )
        }
      >
        <Images className="size-3.5" aria-hidden="true" />
        Make album
      </button>
    )
  }

  /** The triage actions: as words (cards, the selection bar), or as icons only (tiles and rows). */
  function actionsFor(ids: string[], note?: Item, icons = false) {
    const all: { label: string; icon: LucideIcon; run: () => void }[] = [
      ...(note ? [{ label: 'Edit', icon: Pencil, run: () => open(note) }] : []),
      { label: 'Organize', icon: FolderInput, run: () => run(ids, 'organize') },
      ...(backToInbox ? [{ label: 'To inbox', icon: Inbox, run: () => run(ids, 'inbox') }] : []),
      { label: 'Archive', icon: Archive, run: () => run(ids, 'archive') },
      { label: 'Delete', icon: Trash2, run: () => run(ids, 'delete') },
    ]
    // Already in them, for a single item.
    const current = ids.length === 1 ? (items.find((item) => item.id === ids[0])?.collections ?? []) : []
    return all.map(({ label, icon: Icon, run: action }) => {
      const button = (props: object = {}) =>
        icons ? (
          <button
            key={label}
            type="button"
            aria-label={label}
            className="button-icon group size-7"
            onClick={action}
            {...props}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="tooltip top-full mt-1.5">{label}</span>
          </button>
        ) : (
          <button key={label} type="button" className="button-ghost" onClick={action} {...props}>
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        )
      if (label !== 'Organize') return button()
      return (
        <OrganizeMenu
          key={label}
          current={current}
          onPick={(collection) => organizeInto(ids, collection)}
          onMore={action}
          trigger={button}
        />
      )
    })
  }

  return (
    <>
      {visibleSelection.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selection"
          className="popover sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-1 px-2 py-1.5"
        >
          <button
            type="button"
            aria-label="Clear selection (Esc)"
            className="button-icon group size-7"
            onClick={() => setSelected(new Set())}
          >
            <X className="size-4" aria-hidden="true" />
            <span className="tooltip top-full mt-1.5">Clear selection (Esc)</span>
          </button>
          <span className="mr-auto text-sm font-medium">{visibleSelection.length} selected</span>
          {albumAction(visibleSelection)}
          {actionsFor(visibleSelection)}
        </div>
      )}

      <ul className={LAYOUT[mode]}>
        {items.map((item) => {
          const note = item.kind === 'note' ? item : undefined
          const shared = {
            item,
            selected: selected.has(item.id),
            focused: focused === item.id,
            onToggleSelect: () => toggle(item.id),
          }
          const icons = (
            <div className="popover flex gap-0.5 p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {actionsFor([item.id], note, true)}
            </div>
          )
          return (
            <li
              key={item.id}
              className={mode === 'masonry' ? 'mb-4 break-inside-avoid' : undefined}
              ref={(element) => {
                if (element) cards.current.set(item.id, element)
                else cards.current.delete(item.id)
              }}
              onMouseDown={() => setFocused(item.id)}
            >
              {mode === 'grid' ? (
                <ItemTile {...shared} onOpen={() => open(item)} actions={icons} />
              ) : mode === 'list' ? (
                <ItemRow {...shared} onOpen={() => open(item)} actions={icons} />
              ) : (
                <ItemCard
                  {...shared}
                  onOpen={note ? () => open(item) : undefined}
                  onView={() => open(item)}
                  actions={
                    // Masonry columns are too narrow for the actions in words.
                    <div className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {actionsFor([item.id], note, mode === 'masonry')}
                    </div>
                  }
                />
              )}
            </li>
          )
        })}
      </ul>

      {organizing && (
        <CollectionPicker
          count={organizing.length}
          onClose={() => setOrganizing(null)}
          onConfirm={(collections, names) =>
            triage.mutate(
              { ids: organizing, action: 'organize', collections },
              {
                onSuccess: () => {
                  toast({ message: triageMessage('organize', organizing.length, names) })
                  setOrganizing(null)
                  setSelected(new Set())
                },
                onError: failed,
              },
            )
          }
        />
      )}
    </>
  )
}
