import { useState } from 'react'

import type { CollectionKind } from './api'
import { COLLECTION_KINDS } from './collectionKinds'

export type CollectionDraft = { name: string; kind: CollectionKind }

/** Name and kind of a collection, new or existing. */
export function CollectionDialog({
  title,
  submitLabel,
  initial = { name: '', kind: 'project' },
  saving = false,
  error,
  onSubmit,
  onClose,
}: {
  title: string
  submitLabel: string
  initial?: CollectionDraft
  saving?: boolean
  error?: string
  onSubmit: (draft: CollectionDraft) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [kind, setKind] = useState<CollectionKind>(initial.kind)

  return (
    <div
      className="backdrop flex items-start justify-center p-4 pt-[15vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-dialog-title"
        className="popover w-full max-w-md p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) onSubmit({ name: name.trim(), kind })
        }}
      >
        <h2 id="collection-dialog-title" className="mb-4 font-semibold">
          {title}
        </h2>
        <label className="mb-1 block text-sm font-medium" htmlFor="collection-name">
          Name
        </label>
        <input
          id="collection-name"
          className="input"
          placeholder="Trip to Japan, Health, Typography…"
          autoFocus
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="mt-4">
          <legend className="mb-1 text-sm font-medium">Kind</legend>
          <div className="grid grid-cols-3 gap-2">
            {COLLECTION_KINDS.map(({ value, label, hint, icon: Icon }) => (
              <label
                key={value}
                className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition has-focus-visible:ring-3 has-focus-visible:ring-accent-500/30 ${
                  kind === value
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-500/10'
                    : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600'
                }`}
              >
                <input
                  type="radio"
                  name="collection-kind"
                  className="sr-only"
                  value={value}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                <Icon className="size-4 text-accent-600 dark:text-accent-300" aria-hidden="true" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-zinc-500">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!name.trim() || saving}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
