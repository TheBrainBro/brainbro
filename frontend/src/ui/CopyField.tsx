import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/** A read-only value, selected on focus, with a button that copies it. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        className="input font-mono text-xs"
        aria-label={label}
        readOnly
        value={value}
        onFocus={(event) => event.target.select()}
      />
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        className="button-icon shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
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
