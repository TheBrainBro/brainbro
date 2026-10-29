import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCapturePipeline } from '../capture/context'
import { isEditable } from '../lib/dom'
import { MOD } from '../lib/keys'

/**
 * Always-visible capture: type, Enter and done (Shift+Enter for a new line).
 * Pasting or dropping anywhere is handled by the capture pipeline, with no
 * box involved. `/` or Ctrl/Cmd+K focuses the box.
 */
export function CaptureBox() {
  const { capture, dismiss } = useCapturePipeline()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const shortcut =
        (event.key === 'k' && (event.metaKey || event.ctrlKey)) ||
        (event.key === '/' && !isEditable(event.target))
      if (shortcut) {
        event.preventDefault()
        textarea.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function submit() {
    const value = text.trim()
    if (!value || saving) return
    setSaving(true)
    setError(null)
    const [result] = await capture(
      { inputs: [{ kind: 'text', text: value }], skipped: [] },
      { undo: false },
    )
    setSaving(false)
    if ('item' in result) {
      setText('')
    } else {
      // The box shows the error and keeps the text: no failed card as well.
      setError(result.error)
      dismiss(result.id)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <label htmlFor="capture" className="sr-only">
        Capture
      </label>
      <textarea
        id="capture"
        ref={textarea}
        className="input field-sizing-content max-h-64 min-h-11 resize-none"
        placeholder="Paste a link or jot something down… (Enter to save)"
        rows={1}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {/* Phones paste into the box itself and have nothing to drop. */}
      <p className="mt-1.5 hidden items-center justify-end gap-1 text-xs text-zinc-500 sm:flex">
        or paste
        <kbd className="kbd">{MOD}</kbd>
        <kbd className="kbd">V</kbd>
        or drop files anywhere
      </p>
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </form>
  )
}
