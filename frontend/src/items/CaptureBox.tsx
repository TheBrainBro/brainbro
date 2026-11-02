import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCapturePipeline } from '../capture/context'
import { VoiceRecorder } from '../capture/VoiceRecorder'
import { useT } from '../i18n/i18n'
import { isEditable } from '../lib/dom'
import { MOD } from '../lib/keys'

/**
 * Always-visible capture: type, Enter and done (Shift+Enter for a new line),
 * or record a voice note. Pasting or dropping anywhere is handled by the
 * capture pipeline, with no box involved. `/` focuses the box.
 */
export function CaptureBox() {
  const t = useT()
  const { capture, dismiss } = useCapturePipeline()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && !isEditable(event.target)) {
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
        {t('items.capture')}
      </label>
      <textarea
        id="capture"
        ref={textarea}
        className="input field-sizing-content max-h-64 min-h-11 resize-none"
        placeholder={t('items.capturePlaceholder')}
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
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {/* A failed upload keeps its card, with Retry: the recording isn't lost. */}
        <VoiceRecorder
          className="button-ghost"
          label={t('items.voiceNote')}
          onRecorded={(file) => capture({ inputs: [{ kind: 'file', file }], skipped: [] })}
        />
        {/* Phones paste into the box itself and have nothing to drop. */}
        <p className="ml-auto hidden items-center gap-1 text-xs text-zinc-500 sm:flex">
          {t('items.orPaste')}
          <kbd className="kbd">{MOD}</kbd>
          <kbd className="kbd">V</kbd>
          {t('items.orDrop')}
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </form>
  )
}
