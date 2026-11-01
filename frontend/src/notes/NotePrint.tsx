import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

import { t } from '../i18n/i18n'
import type { NoteImages, NoteLinks } from '../items/api'
import { renderNote } from '../lib/markdown'
import { noteTitle } from './title'

/** How long to wait for the note's images before printing without them. */
const IMAGES_TIMEOUT_MS = 5000

/**
 * The note as a document, for the browser's print dialog (and its *Save as
 * PDF*). Mounting it prints: it waits for the images, names the page after
 * the note (the PDF's file name) and calls `onDone` once the dialog closes.
 * Only it prints while it is on the page (see `.print-root` in index.css).
 */
export function NotePrint({
  body,
  images,
  links,
  onDone,
}: {
  body: string
  images?: NoteImages | null
  links?: NoteLinks | null
  onDone: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  // Prints once, with what it was mounted with.
  const mounted = useRef({ body, onDone })
  // Cards, not players: an iframe prints as a blank box.
  const html = useMemo(
    () => renderNote(body, { docId: 'print', images, links }),
    [body, images, links],
  )

  useEffect(() => {
    const { body, onDone } = mounted.current
    let cancelled = false
    const title = document.title
    function finish() {
      document.title = title
      onDone()
    }
    loadImages(root.current!).then(() => {
      if (cancelled) return
      document.title = noteTitle(body, t('editor.untitled'))
      window.addEventListener('afterprint', finish, { once: true })
      window.print()
    })
    return () => {
      cancelled = true
      window.removeEventListener('afterprint', finish)
      document.title = title
    }
  }, [])

  return createPortal(
    <div
      ref={root}
      className="print-root markdown note-print"
      dangerouslySetInnerHTML={{ __html: html }}
    />,
    document.body,
  )
}

/** Every image loaded (or failed), lazy ones included; at most a few seconds. */
function loadImages(element: HTMLElement) {
  const pending = [...element.querySelectorAll('img')].filter((image) => {
    image.loading = 'eager'
    return !image.complete
  })
  const loaded = Promise.all(
    pending.map(
      (image) =>
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', resolve, { once: true })
        }),
    ),
  )
  const timeout = new Promise((resolve) => setTimeout(resolve, IMAGES_TIMEOUT_MS))
  return Promise.race([loaded, timeout])
}
