import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { useT } from '../i18n/i18n'
import { copyText } from '../lib/dom'

/** A read-only value, selected on focus, with a button that copies it. */
export function CopyField({
  label,
  value,
  multiline = false,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-2">
      {multiline ? (
        <textarea
          className="input min-h-32 resize-y font-mono text-xs"
          aria-label={label}
          readOnly
          rows={7}
          value={value}
          onFocus={(event) => event.target.select()}
        />
      ) : (
        <input
          className="input font-mono text-xs"
          aria-label={label}
          readOnly
          value={value}
          onFocus={(event) => event.target.select()}
        />
      )}
      <button
        type="button"
        aria-label={t('ui.copy', { what: label.toLowerCase() })}
        className="button-icon shrink-0"
        onClick={() => {
          void copyText(value).then(() => setCopied(true))
        }}
      >
        {copied ? (
          <Check className="size-4 text-accent-600" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
