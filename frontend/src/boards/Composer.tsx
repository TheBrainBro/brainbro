import { useState } from 'react'

import { useT } from '../i18n/i18n'

export type ComposerKind = 'note' | 'link'

/** A note or a link written from the board's toolbar; it lands near the middle of the view. */
export function Composer({ kind, onDone }: { kind: ComposerKind; onDone: (text: string) => void }) {
  const t = useT()
  const [text, setText] = useState('')
  const submit = () => onDone(text.trim())

  return (
    <form
      className="popover w-96 max-w-[calc(100vw-2rem)] space-y-2 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {kind === 'note' ? (
        <textarea
          autoFocus
          aria-label={t('nodes.newNote')}
          placeholder={t('nodes.notePlaceholder')}
          rows={4}
          className="input resize-none"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
            if (event.key === 'Escape') onDone('')
          }}
        />
      ) : (
        <input
          autoFocus
          type="url"
          aria-label={t('nodes.newLink')}
          placeholder="https://…"
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onDone('')}
        />
      )}
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-zinc-500">
          {kind === 'note' ? t('nodes.noteKeys') : t('nodes.linkKeys')}
        </span>
        <button type="button" className="button-secondary px-3 py-1.5" onClick={() => onDone('')}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="button-primary px-3 py-1.5" disabled={!text.trim()}>
          {t('nodes.add')}
        </button>
      </div>
    </form>
  )
}
