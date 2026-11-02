import { ClipboardPaste, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import type { CaptureInput } from '../capture/inputs'
import { VoiceRecorder } from '../capture/VoiceRecorder'
import { useT } from '../i18n/i18n'

/**
 * `/capture`: the phone's quick capture (the tab bar's +, the app icon's
 * shortcut). Type or paste, or pick photos and files; it all goes to the
 * inbox, which shows it arriving. On iOS, with no share target, this is the
 * way in for photos and files. Or record a voice note.
 */
export function CapturePage() {
  const t = useT()
  const { capture } = useCapturePipeline()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  function send(inputs: CaptureInput[]) {
    if (!inputs.length) return
    navigate('/', { replace: true })
    void capture({ inputs, skipped: [] })
  }

  return (
    <form
      className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        const value = text.trim()
        if (value) send([{ kind: 'text', text: value }])
      }}
    >
      {/* Actions on top: the keyboard and the toast take the bottom. */}
      <div className="flex items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{t('capture.title')}</h1>
        <Link to="/" className="button-secondary">
          {t('common.cancel')}
        </Link>
        <button type="submit" className="button-primary" disabled={!text.trim()}>
          {t('common.save')}
        </button>
      </div>
      <label htmlFor="quick-capture" className="sr-only">
        {t('capture.textOrLink')}
      </label>
      <textarea
        id="quick-capture"
        className="input field-sizing-content max-h-[50vh] min-h-40 resize-none text-base"
        placeholder={t('capture.placeholder')}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-label={t('capture.upload')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          send(files.map((file) => ({ kind: 'file', file })))
        }}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="button-outline" onClick={() => picker.current?.click()}>
          <Upload className="size-4" aria-hidden="true" />
          {t('capture.upload')}
        </button>
        {canPaste && (
          <button
            type="button"
            className="button-outline"
            onClick={async () => {
              try {
                const pasted = await navigator.clipboard.readText()
                if (pasted) setText((current) => (current ? `${current}\n${pasted}` : pasted))
              } catch {
                // Permission refused: the textarea's own paste still works.
              }
            }}
          >
            <ClipboardPaste className="size-4" aria-hidden="true" />
            {t('capture.paste')}
          </button>
        )}
        <VoiceRecorder onRecorded={(file) => send([{ kind: 'file', file }])} />
      </div>
    </form>
  )
}
