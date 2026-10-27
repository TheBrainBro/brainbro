import { useEffect, useRef, useState } from 'react'

import { isEditable } from '../lib/dom'
import { useCapture } from './api'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/**
 * Always-visible capture: type, Enter and done (Shift+Enter for a new line).
 * Pasting anywhere outside a text field captures right away, with no box
 * involved. `/` or Ctrl/Cmd+K focuses the box.
 */
export function CaptureBox() {
  const capture = useCapture()
  const { mutate: captureText } = capture
  const [text, setText] = useState('')
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
    function onPaste(event: ClipboardEvent) {
      if (isEditable(event.target)) return
      const pasted = event.clipboardData?.getData('text')
      if (!pasted) return
      event.preventDefault()
      if (pasted.trim()) captureText(pasted.trim())
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [captureText])

  function submit() {
    const value = text.trim()
    if (!value || capture.isPending) return
    capture.mutate(value, { onSuccess: () => setText('') })
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
      <p className="mt-1.5 flex items-center justify-end gap-1 text-xs text-zinc-500">
        or paste anywhere
        <kbd className="kbd">{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd className="kbd">V</kbd>
      </p>
      {capture.isError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {capture.error.message}
        </p>
      )}
    </form>
  )
}
