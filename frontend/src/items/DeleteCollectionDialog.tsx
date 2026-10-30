import { useEffect, useRef, useState } from 'react'

import { useCollections, type Collection, type OrphanAction } from './api'
import { childrenOf } from './collectionTree'

const CHOICES: { value: OrphanAction; label: string; hint: string }[] = [
  { value: 'inbox', label: 'Move them to the inbox', hint: 'To sort them again.' },
  { value: 'archive', label: 'Archive them', hint: 'Kept, out of the way.' },
  { value: 'delete', label: 'Delete them', hint: "For good: it can't be undone." },
]

/**
 * Asks what happens to the items only in `collection` before deleting it,
 * and says where the collections inside it go: up to its parent.
 */
export function DeleteCollectionDialog({
  collection,
  deleting,
  onDelete,
  onClose,
}: {
  collection: Collection
  deleting: boolean
  onDelete: (items: OrphanAction) => void
  onClose: () => void
}) {
  const [choice, setChoice] = useState<OrphanAction>('inbox')
  const all = useCollections().data ?? []
  const inside = childrenOf(all, collection.id).length
  const parent = all.find((candidate) => candidate.id === collection.parent)
  const confirmButton = useRef<HTMLButtonElement>(null)
  useEffect(() => confirmButton.current?.focus(), [])

  return (
    <div
      className="backdrop flex items-start justify-center p-4 pt-[15vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-collection-title"
        className="popover w-full max-w-sm p-5"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
        }}
        onSubmit={(event) => {
          event.preventDefault()
          onDelete(choice)
        }}
      >
        <h2 id="delete-collection-title" className="font-semibold">
          Delete “{collection.name}”?
        </h2>
        <fieldset className="mt-3">
          <legend className="text-sm text-zinc-500 dark:text-zinc-400">
            Items that are only in this collection:
          </legend>
          <div className="mt-2 space-y-1">
            {CHOICES.map(({ value, label, hint }) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <input
                  type="radio"
                  name="collection-items"
                  className="mt-1 accent-accent-600"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                <span>
                  <span className={value === 'delete' ? 'text-red-600 dark:text-red-400' : undefined}>
                    {label}
                  </span>
                  <span className="block text-xs text-zinc-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="mt-2 text-xs text-zinc-500">
          Items also in other collections stay there. Archived items stay archived.
        </p>
        {inside > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            {inside === 1 ? 'The collection inside it moves' : `The ${inside} collections inside it move`}{' '}
            {parent ? `to ${parent.name}` : 'to the top'}.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button ref={confirmButton} type="submit" className="button-danger" disabled={deleting}>
            Delete collection
          </button>
        </div>
      </form>
    </div>
  )
}
