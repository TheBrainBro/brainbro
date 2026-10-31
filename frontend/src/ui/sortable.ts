import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'

const MOVE_MS = 180

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
  const layout = useRef<{ key: string; rects: Map<string, { x: number; y: number }> }>(null)
  // Moved with the keyboard: focus follows it to its new place.
  const refocus = useRef<string | null>(null)

  // Entries that change place glide there (FLIP), as in the item lists.
  useLayoutEffect(() => {
    const origin = list.current?.getBoundingClientRect()
    if (!origin) return
    const key = shown.map((entry) => entry.id).join()
    const rects = new Map<string, { x: number; y: number }>()
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    for (const entry of shown) {
      const element = elements.current.get(entry.id)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      const at = { x: rect.left - origin.left, y: rect.top - origin.top }
      rects.set(entry.id, at)
      const before = layout.current?.rects.get(entry.id)
      if (!before || layout.current?.key === key || reduced) continue
      const dx = before.x - at.x
      const dy = before.y - at.y
      if (dx || dy) {
        element.animate?.(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: 'ease-out' },
        )
      }
    }
    layout.current = { key, rects }

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

  function dragOver(entry: T) {
    if (!dragging || entry.id === dragging) return
    const ids = preview?.base === entries ? preview.ids : entries.map((each) => each.id)
    const to = ids.indexOf(entry.id)
    const next = ids.filter((id) => id !== dragging)
    next.splice(to, 0, dragging)
    setPreview({ base: entries, ids: next })
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
      onDragOver: () => dragOver(entry),
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
