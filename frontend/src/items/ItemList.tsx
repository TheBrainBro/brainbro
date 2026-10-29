import { Archive, FolderInput, Inbox, Pencil, Trash2, type LucideIcon } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { isEditable } from '../lib/dom'
import { useViewer } from '../viewer/context'
import { CollectionPicker } from './CollectionPicker'
import { ItemCard } from './ItemCard'
import { ItemRow, ItemTile } from './ItemTile'
import type { ViewMode } from './viewMode'
import { useMakeAlbum, useSetAlbumItems, useTriage, type Item, type TriageAction } from './api'

const LAYOUT: Record<ViewMode, string> = {
  cards: 'space-y-3',
  list: 'space-y-1.5',
  grid: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
  // Columns, Pinterest-like: each card keeps its own height.
  masonry: 'columns-1 gap-4 sm:columns-2 lg:columns-3',
}

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [organizing, setOrganizing] = useState<string[] | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  // Forget selections of items that left this list (triaged elsewhere).
  const visibleSelection = items.filter((item) => selected.has(item.id)).map((item) => item.id)

  function run(ids: string[], action: TriageAction) {
    if (!ids.length) return
    if (action === 'organize') {
      setOrganizing(ids)
      return
    }
    if (
      action === 'delete' &&
      !window.confirm(ids.length === 1 ? 'Delete this item?' : `Delete ${ids.length} items?`)
    ) {
      return
    }
    triage.mutate({ ids, action }, { onSuccess: () => setSelected(new Set()) })
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
    const done = { onSuccess: () => setSelected(new Set()) }
    if (albums.length === 1 && images.length > 0) {
      const album = albums[0]
      const inside = (album.album_items ?? []).map((image) => image.id)
      return (
        <button
          type="button"
          className={actionButton}
          onClick={() =>
            setAlbumItems.mutate(
              { album: album.id, ids: [...inside, ...images.map((image) => image.id)] },
              done,
            )
          }
        >
          Add to album
        </button>
      )
    }
    if (albums.length > 0 || images.length < 2) return null
    return (
      <button
        type="button"
        className={actionButton}
        onClick={() => makeAlbum.mutate({ ids: images.map((image) => image.id) }, done)}
      >
        Make album
      </button>
    )
  }

  /** The triage actions: as words (cards, the selection bar), or as icons (tiles and rows). */
  function actionsFor(ids: string[], note?: Item, icons = false) {
    const all: { label: string; icon: LucideIcon; run: () => void }[] = [
      ...(note ? [{ label: 'Edit', icon: Pencil, run: () => open(note) }] : []),
      { label: 'Organize', icon: FolderInput, run: () => run(ids, 'organize') },
      ...(backToInbox ? [{ label: 'To inbox', icon: Inbox, run: () => run(ids, 'inbox') }] : []),
      { label: 'Archive', icon: Archive, run: () => run(ids, 'archive') },
      { label: 'Delete', icon: Trash2, run: () => run(ids, 'delete') },
    ]
    return all.map(({ label, icon: Icon, run: action }) =>
      icons ? (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          className="button-icon size-7"
          onClick={action}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <button key={label} type="button" className={actionButton} onClick={action}>
          {label}
        </button>
      ),
    )
  }

  return (
    <>
      {visibleSelection.length > 0 && (
        <div
          role="toolbar"
          aria-label="Selection"
          className="sticky top-2 z-20 mb-3 flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <span className="mr-auto text-sm font-medium">{visibleSelection.length} selected</span>
          {albumAction(visibleSelection)}
          {actionsFor(visibleSelection)}
          <button type="button" className={actionButton} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {(triage.error ?? makeAlbum.error ?? setAlbumItems.error) && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {(triage.error ?? makeAlbum.error ?? setAlbumItems.error)?.message}
        </p>
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
                    <div className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      {actionsFor([item.id], note)}
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
          onConfirm={(collections) =>
            triage.mutate(
              { ids: organizing, action: 'organize', collections },
              {
                onSuccess: () => {
                  setOrganizing(null)
                  setSelected(new Set())
                },
              },
            )
          }
        />
      )}
    </>
  )
}
