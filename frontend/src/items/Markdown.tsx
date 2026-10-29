import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { NoteImages } from './api'
import { renderNote, toggleTaskAt } from '../lib/markdown'

/**
 * A note's Markdown, rendered the way the editor reads it (see
 * lib/markdown). Long notes are cut off with a fade, at a fixed height or,
 * with `fill`, at the height of the box it is in. With `onChange`, task
 * checkboxes can be ticked and the new text is handed back. Images show the
 * note's stored copies (`images`), never the remote ones.
 */
export function Markdown({
  children,
  id,
  fill = false,
  images,
  onChange,
}: {
  children: string
  /** Keeps footnote anchors unique when several notes are on the page. */
  id?: string
  fill?: boolean
  images?: NoteImages | null
  onChange?: (body: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  // Same string, same DOM: React leaves the HTML alone across re-renders, so
  // a checkbox under the pointer is never replaced between press and click.
  const tasks = Boolean(onChange)
  const html = useMemo(
    () => renderNote(children, { docId: id, tasks, images }),
    [children, id, tasks, images],
  )

  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setClipped(isClipped(element))
    measure()
    // Filling a box that can be resized: the cut moves with it.
    if (!fill) return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [html, fill])

  return (
    <div
      ref={box}
      data-clipped={clipped || undefined}
      // Images take their height once loaded: the cut may move.
      onLoadCapture={(event) => setClipped(isClipped(event.currentTarget))}
      className={`markdown overflow-hidden break-words data-clipped:mask-b-from-60% ${fill ? 'h-full' : 'max-h-60'}`}
      onClick={(event) => {
        const target = event.target as HTMLElement
        // Links leave the app; the click is theirs, not the card's.
        if (target.closest('a')) event.stopPropagation()
        const task = target.closest<HTMLInputElement>('input[data-task-line]')
        if (!task || !onChange) return
        event.stopPropagation()
        onChange(toggleTaskAt(children, Number(task.dataset.taskLine)))
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function isClipped(element: HTMLElement) {
  return element.scrollHeight > element.clientHeight + 1
}
