import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { renderNote, toggleTaskAt } from '../lib/markdown'

/**
 * A note's Markdown, rendered the way the editor reads it (see
 * lib/markdown). Long notes are cut off with a fade. With `onChange`, task
 * checkboxes can be ticked and the new text is handed back.
 */
export function Markdown({
  children,
  id,
  onChange,
}: {
  children: string
  /** Keeps footnote anchors unique when several notes are on the page. */
  id?: string
  onChange?: (body: string) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  // Same string, same DOM: React leaves the HTML alone across re-renders, so
  // a checkbox under the pointer is never replaced between press and click.
  const tasks = Boolean(onChange)
  const html = useMemo(() => renderNote(children, { docId: id, tasks }), [children, id, tasks])

  useLayoutEffect(() => {
    const element = box.current
    if (element) setClipped(element.scrollHeight > element.clientHeight + 1)
  }, [html])

  return (
    <div
      ref={box}
      data-clipped={clipped || undefined}
      className="markdown max-h-60 overflow-hidden break-words data-clipped:mask-b-from-60%"
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
