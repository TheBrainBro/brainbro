import { Archive, FolderInput, Images, Inbox, Pencil, Trash2, X, type LucideIcon } from 'lucide-react'
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { useNavigate } from 'react-router'

import { isEditable } from '../lib/dom'
import { useFeedback } from '../ui/feedback'
import { isMoving, useFlip } from '../ui/flip'
import { useViewer } from '../viewer/context'
import { CollectionPicker } from './CollectionPicker'
import { ItemCard } from './ItemCard'
import { ItemRow, ItemTile } from './ItemTile'
import { OrganizeMenu } from './OrganizeMenu'
import type { ViewMode } from './viewMode'
import {
  useMakeAlbum,
  useMoveItem,
  useSetAlbumItems,
  useTriage,
  type Collection,
  type Item,
  type MoveTarget,
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

/** The order shown while dragging, for the list it was taken from. */
type Preview = { base: Item[]; ids: string[] }

/**
 * Items with triage: per-card actions, multi-select and keyboard shortcuts
 * (j/k move, Enter open a note, x select, o organize, e archive, # delete,
 * Esc clear). With `sortable`, items can be dragged to a new place in that
 * list (the others make way as it moves), or moved with Alt+↑/↓.
 */
export function ItemList({
  items,
  backToInbox = false,
  archived = false,
  mode = 'cards',
  sortable,
}: {
  items: Item[]
  backToInbox?: boolean
  /** Archived items: they can go back to the inbox, not be archived again. */
  archived?: boolean
  mode?: ViewMode
  /** The hand-sorted list these items are: the inbox, or a collection. */
  sortable?: MoveTarget
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
  const moveItem = useMoveItem()
  const [dragging, setDragging] = useState<string | null>(null)
  // Kept until the list itself has the new order (or changes otherwise).
  const [preview, setPreview] = useState<Preview | null>(null)
  const byId = new Map(items.map((item) => [item.id, item]))
  const shown =
    preview?.base === items
      ? preview.ids.map((id) => byId.get(id)).filter((item): item is Item => Boolean(item))
      : items
  const list = useRef<HTMLUListElement>(null)

  // Items that change place glide there.
  useFlip(shown.map((item) => item.id), cards, list)

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

  /** Unticked in the organize menu; undo puts it back in. */
  function takeOutOf(ids: string[], collection: Collection) {
    triage.mutate(
      { ids, action: 'unorganize', collections: [collection.id] },
      {
        onSuccess: () => {
          setSelected(new Set())
          toast({
            message: triageMessage('unorganize', ids.length, collection.name),
            actions: undoAction([{ ids, action: 'organize', collections: [collection.id] }]),
          })
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

  /** Puts `id` right after `after` (null: first), unless that's where it is. */
  function place(id: string, after: string | null) {
    const index = items.findIndex((item) => item.id === id)
    if ((index === 0 && after === null) || items[index - 1]?.id === after) return
    moveItem.mutate({ id, after, ...sortable }, { onError: failed })
  }

  /**
   * The dragged item takes `item`'s place once the pointer is past the middle
   * of it (in the direction of travel), so it doesn't flip back and forth
   * over items of another size.
   */
  function dragOver(event: DragEvent, item: Item) {
    // Still gliding into place: passing under the pointer isn't a drag over it.
    if (!dragging || item.id === dragging || isMoving(event.currentTarget)) return
    const ids = preview?.base === items ? preview.ids : items.map((each) => each.id)
    const from = ids.indexOf(dragging)
    const to = ids.indexOf(item.id)
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.height && mode !== 'grid') {
      const middle = rect.top + rect.height / 2
      if (to > from ? event.clientY < middle : event.clientY > middle) return
    }
    const next = ids.filter((id) => id !== dragging)
    next.splice(to, 0, dragging)
    if (next.join() !== ids.join()) setPreview({ base: items, ids: next })
  }

  function dropped() {
    if (!dragging) return
    const ids = shown.map((item) => item.id)
    const at = ids.indexOf(dragging)
    place(dragging, ids[at - 1] ?? null)
    setDragging(null)
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (organizing || isEditable(event.target) || event.metaKey || event.ctrlKey) return
    const index = items.findIndex((item) => item.id === focused)
    const targets = visibleSelection.length ? visibleSelection : focused ? [focused] : []

    // Alt+↑/↓ moves the focused item one place.
    if (event.altKey && sortable && focused && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (event.key === 'ArrowUp' && index > 0) place(focused, items[index - 2]?.id ?? null)
      if (event.key === 'ArrowDown' && index < items.length - 1) place(focused, items[index + 1].id)
      return
    }

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
      ...(backToInbox || archived
        ? [{ label: 'To inbox', icon: Inbox, run: () => run(ids, 'inbox') }]
        : []),
      ...(archived ? [] : [{ label: 'Archive', icon: Archive, run: () => run(ids, 'archive') }]),
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
            className="button-icon group/tip size-7"
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
          onRemove={(collection) => takeOutOf(ids, collection)}
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
            className="button-icon group/tip size-7"
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

      <ul
        ref={list}
        className={LAYOUT[mode]}
        // Dropped anywhere on the list, gaps included: where it is shown now.
        onDragOver={(event) => {
          // Only our own drags; files from outside are captures.
          if (!dragging) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          if (!dragging) return
          event.preventDefault()
          dropped()
        }}
      >
        {shown.map((item) => {
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
              className={`relative transition-opacity ${mode === 'masonry' ? 'mb-4 break-inside-avoid' : ''} ${
                sortable ? 'cursor-grab active:cursor-grabbing' : ''
              } ${dragging === item.id ? 'opacity-40' : ''}`}
              ref={(element) => {
                if (element) cards.current.set(item.id, element)
                else cards.current.delete(item.id)
              }}
              onMouseDown={() => setFocused(item.id)}
              draggable={Boolean(sortable)}
              onDragStart={(event) => {
                if (!sortable) return
                setDragging(item.id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => dragOver(event, item)}
              onDragEnd={() => {
                // Let go outside the list: everything goes back.
                if (dragging) setPreview(null)
                setDragging(null)
              }}
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
