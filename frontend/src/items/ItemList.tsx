import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { isEditable } from '../lib/dom'
import { useViewer } from '../viewer/context'
import { CollectionPicker } from './CollectionPicker'
import { ItemCard } from './ItemCard'
import { useTriage, type Item, type TriageAction } from './api'

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/**
 * Items with triage: per-card actions, multi-select and keyboard shortcuts
 * (j/k move, Enter open a note, x select, o organize, e archive, # delete,
 * Esc clear).
 */
export function ItemList({ items, backToInbox = false }: { items: Item[]; backToInbox?: boolean }) {
  const triage = useTriage()
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

  function actionsFor(ids: string[], note?: Item) {
    return (
      <>
        {note && (
          <button type="button" className={actionButton} onClick={() => open(note)}>
            Edit
          </button>
        )}
        <button type="button" className={actionButton} onClick={() => run(ids, 'organize')}>
          Organize
        </button>
        {backToInbox && (
          <button type="button" className={actionButton} onClick={() => run(ids, 'inbox')}>
            To inbox
          </button>
        )}
        <button type="button" className={actionButton} onClick={() => run(ids, 'archive')}>
          Archive
        </button>
        <button type="button" className={actionButton} onClick={() => run(ids, 'delete')}>
          Delete
        </button>
      </>
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
          {actionsFor(visibleSelection)}
          <button type="button" className={actionButton} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {triage.isError && (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {triage.error.message}
        </p>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            ref={(element) => {
              if (element) cards.current.set(item.id, element)
              else cards.current.delete(item.id)
            }}
            onMouseDown={() => setFocused(item.id)}
          >
            <ItemCard
              item={item}
              selected={selected.has(item.id)}
              focused={focused === item.id}
              onToggleSelect={() => toggle(item.id)}
              onOpen={item.kind === 'note' ? () => open(item) : undefined}
              onView={() => open(item)}
              actions={
                <div className="flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  {actionsFor([item.id], item.kind === 'note' ? item : undefined)}
                </div>
              }
            />
          </li>
        ))}
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
