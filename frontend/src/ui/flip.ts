import { useLayoutEffect, useRef, type RefObject } from 'react'

const MOVE_MS = 180

type Point = { x: number; y: number }

/** Whether `element` is gliding to a new place right now. */
export function isMoving(element: Element) {
  return element.getAnimations?.().some((animation) => animation.playState === 'running') ?? false
}

/**
 * Entries that change place glide there (FLIP). Places are kept relative to
 * the list, so scrolling isn't movement, and measured without the motion in
 * flight: a new move starts from where the entry is seen, never from where an
 * unfinished one would have left it, so moves can't pile up.
 */
export function useFlip(
  ids: string[],
  elements: RefObject<Map<string, HTMLElement>>,
  list: RefObject<HTMLElement | null>,
) {
  const layout = useRef<{ key: string; places: Map<string, Point> }>(null)

  useLayoutEffect(() => {
    const origin = list.current?.getBoundingClientRect()
    if (!origin) return
    const key = ids.join()
    const place = (rect: DOMRect) => ({ x: rect.left - origin.left, y: rect.top - origin.top })

    // Same order: let moves finish, only refresh what stands still.
    if (layout.current?.key === key) {
      for (const id of ids) {
        const element = elements.current.get(id)
        if (element && !isMoving(element)) {
          layout.current.places.set(id, place(element.getBoundingClientRect()))
        }
      }
      return
    }

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const places = new Map<string, Point>()
    for (const id of ids) {
      const element = elements.current.get(id)
      if (!element) continue
      // Where it is seen now, mid-move, then where the new order puts it.
      const seen = element.getBoundingClientRect()
      for (const animation of element.getAnimations?.() ?? []) animation.cancel()
      const rect = element.getBoundingClientRect()
      const at = place(rect)
      places.set(id, at)
      const before = layout.current?.places.get(id)
      if (!before || reduced) continue
      const dx = before.x - at.x + (seen.left - rect.left)
      const dy = before.y - at.y + (seen.top - rect.top)
      if (dx || dy) {
        element.animate?.(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: 'ease-out' },
        )
      }
    }
    layout.current = { key, places }
  })
}
