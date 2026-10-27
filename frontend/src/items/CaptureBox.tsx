import { useEffect, useRef, useState } from 'react'

import { useCapture } from './api'

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/**
 * Always-visible capture: paste or type, Enter and done (Shift+Enter for a
 * new line). `/` or Ctrl/Cmd+K focuses it, and pasting anywhere on the page
 * lands here.
 */
export function CaptureBox() {
  const capture = useCapture()
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
      setText((current) => current + pasted)
      textarea.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

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
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {capture.isError && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {capture.error.message}
        </p>
      )}
    </form>
  )
}
