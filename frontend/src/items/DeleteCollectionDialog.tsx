import { useEffect, useRef, useState } from 'react'

import { t, useT, type MessageKey } from '../i18n/i18n'
import { useCollections, type Collection, type OrphanAction } from './api'
import { childrenOf } from './collectionTree'

const CHOICES: { value: OrphanAction; label: MessageKey; hint: MessageKey }[] = [
  { value: 'inbox', label: 'deleteCollection.toInbox', hint: 'deleteCollection.toInboxHint' },
  { value: 'archive', label: 'deleteCollection.archive', hint: 'deleteCollection.archiveHint' },
  { value: 'delete', label: 'deleteCollection.delete', hint: 'deleteCollection.deleteHint' },
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
  useT()
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
          {t('deleteCollection.title', { name: collection.name })}
        </h2>
        <fieldset className="mt-3">
          <legend className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('deleteCollection.onlyHere')}
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
                    {t(label)}
                  </span>
                  <span className="block text-xs text-zinc-500">{t(hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="mt-2 text-xs text-zinc-500">
          {t('deleteCollection.elsewhere')}
        </p>
        {inside > 0 && (
          <p className="mt-2 text-xs text-zinc-500">
            {parent
              ? t('deleteCollection.insideTo', { count: inside, parent: parent.name })
              : t('deleteCollection.insideToTop', { count: inside })}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button ref={confirmButton} type="submit" className="button-danger" disabled={deleting}>
            {t('deleteCollection.confirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
