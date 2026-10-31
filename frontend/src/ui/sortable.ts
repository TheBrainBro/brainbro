import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

import { isMoving, useFlip } from './flip'

/** Keys that move the focused entry one place back or forward, with Alt. */
const BACK = ['ArrowUp', 'ArrowLeft']
const FORWARD = ['ArrowDown', 'ArrowRight']

/**
 * A hand-sorted grid: entries can be dragged to a new place (the others make
 * way as it moves) or moved with Alt+arrows while focused. `onMove` puts `id`
 * right after `after` (null: first). Spread `listProps` on the list and
 * `itemProps(entry)` on each entry, and render `shown`.
 */
export function useSortable<T extends { id: string }>(
  entries: T[],
  onMove: (id: string, after: string | null) => void,
) {
  const [dragging, setDragging] = useState<string | null>(null)
  // The order shown while dragging, kept until `entries` has the new one.
  const [preview, setPreview] = useState<{ base: T[]; ids: string[] } | null>(null)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const shown =
    preview?.base === entries
      ? preview.ids.map((id) => byId.get(id)).filter((entry): entry is T => Boolean(entry))
      : entries
  const elements = useRef(new Map<string, HTMLElement>())
  const list = useRef<HTMLElement | null>(null)
  const refocus = useRef<string | null>(null)

  useFlip(shown.map((entry) => entry.id), elements, list)

  // Moved with the keyboard: focus follows it to its new place.
  useLayoutEffect(() => {
    const moved = refocus.current && elements.current.get(refocus.current)
    if (moved && !moved.contains(document.activeElement)) {
      refocus.current = null
      moved.querySelector<HTMLElement>('a, button')?.focus()
    }
  })

  /** Puts `id` right after `after` (null: first), unless that's where it is. */
  function place(id: string, after: string | null) {
    const index = entries.findIndex((entry) => entry.id === id)
    if ((index === 0 && after === null) || entries[index - 1]?.id === after) return
    onMove(id, after)
  }

  /**
   * The dragged entry takes `entry`'s place. Not while `entry` is still
   * gliding: passing under the pointer on its way isn't being dragged over,
   * and taking that for a move made entries swap back and forth for ever.
   */
  function dragOver(event: DragEvent, entry: T) {
    if (!dragging || entry.id === dragging || isMoving(event.currentTarget)) return
    const ids = preview?.base === entries ? preview.ids : entries.map((each) => each.id)
    const to = ids.indexOf(entry.id)
    const next = ids.filter((id) => id !== dragging)
    next.splice(to, 0, dragging)
    if (next.join() !== ids.join()) setPreview({ base: entries, ids: next })
  }

  function keyDown(event: KeyboardEvent, entry: T) {
    if (!event.altKey) return
    const index = entries.indexOf(entry)
    let after: string | null | undefined
    if (BACK.includes(event.key) && index > 0) after = entries[index - 2]?.id ?? null
    if (FORWARD.includes(event.key) && index < entries.length - 1) after = entries[index + 1].id
    if (after === undefined) return
    event.preventDefault()
    refocus.current = entry.id
    place(entry.id, after)
  }

  const listProps = {
    ref: (element: HTMLElement | null) => {
      list.current = element
    },
    // Dropped anywhere on the list, gaps included: where it is shown now.
    onDragOver: (event: DragEvent) => {
      // Only our own drags; files from outside are captures.
      if (!dragging) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    },
    onDrop: (event: DragEvent) => {
      if (!dragging) return
      event.preventDefault()
      const ids = shown.map((entry) => entry.id)
      place(dragging, ids[ids.indexOf(dragging) - 1] ?? null)
      setDragging(null)
    },
  }

  function itemProps(entry: T) {
    return {
      ref: (element: HTMLElement | null) => {
        if (element) elements.current.set(entry.id, element)
        else elements.current.delete(entry.id)
      },
      draggable: true,
      className: `cursor-grab transition-opacity active:cursor-grabbing ${
        dragging === entry.id ? 'opacity-40' : ''
      }`,
      onDragStart: (event: DragEvent) => {
        setDragging(entry.id)
        event.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (event: DragEvent) => dragOver(event, entry),
      onDragEnd: () => {
        // Let go outside the list: everything goes back.
        if (dragging) setPreview(null)
        setDragging(null)
      },
      onKeyDown: (event: KeyboardEvent) => keyDown(event, entry),
    }
  }

  return { shown, listProps, itemProps }
}
