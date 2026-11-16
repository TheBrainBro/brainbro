import { FolderPlus } from 'lucide-react'
import { useState } from 'react'

import { useT } from '../i18n/i18n'
import { useCollections, useCreateCollection } from './api'
import { CollectionAvatar } from './CollectionAvatar'
import { CollectionPlace } from './CollectionPlace'

/**
 * Pick one or more collections. The input filters the list; Enter toggles
 * the exact match or creates a new collection with that name.
 */
export function CollectionPicker({
  count,
  onConfirm,
  onClose,
}: {
  count: number
  /** The chosen collections, and their names for a message ("Work, Reading"). */
  onConfirm: (collectionIds: string[], names: string) => void
  onClose: () => void
}) {
  const t = useT()
  const collections = useCollections()
  const create = useCreateCollection()
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const all = collections.data ?? []
  const needle = query.trim().toLowerCase()
  const visible = needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all
  const named = all.filter((c) => c.name.toLowerCase() === needle)

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    const names = all.filter((c) => checked.has(c.id)).map((c) => c.name)
    onConfirm([...checked], names.join(', '))
  }

  function onEnter() {
    if (!needle) {
      if (checked.size) confirm()
      return
    }
    // Several with this name, in different places: the list shows where each
    // one is, and picking is left to a click.
    if (named.length > 1) return
    if (named.length === 1) {
      toggle(named[0].id)
      setQuery('')
      return
    }
    create.mutate(
      { name: query.trim() },
      {
        onSuccess: (collection) => {
          setChecked((current) => new Set(current).add(collection.id))
          setQuery('')
        },
      },
    )
  }

  return (
    <div
      className="backdrop flex items-start justify-center p-4 pt-[15vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('collectionPicker.label')}
        className="popover w-full max-w-sm p-3"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <p className="px-1 pb-2 text-sm text-zinc-500">
          {t('collectionPicker.title', { count })}
        </p>
        <input
          className="input"
          placeholder={t('collectionPicker.find')}
          aria-label={t('collectionPicker.find')}
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onEnter()
            }
          }}
        />
        {create.isError && (
          <p role="alert" className="mt-1 text-sm text-red-600">
            {create.error.message}
          </p>
        )}
        <ul className="mt-2 max-h-64 overflow-auto">
          {visible.map((collection) => (
            <li key={collection.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  className="accent-accent-600"
                  checked={checked.has(collection.id)}
                  onChange={() => toggle(collection.id)}
                />
                <CollectionAvatar collection={collection} size="sm" />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="truncate">{collection.name}</span>
                  <CollectionPlace collections={all} id={collection.id} />
                </span>
                <span className="text-xs text-zinc-400">{collection.item_count}</span>
              </label>
            </li>
          ))}
          {!needle && all.length === 0 && collections.isSuccess && (
            <li className="px-2 py-1.5 text-sm text-zinc-500">
              {t('collectionPicker.none')}
            </li>
          )}
          {needle && named.length === 0 && (
            <li className="flex items-center gap-2 px-2 py-1.5 text-sm text-zinc-500">
              <FolderPlus className="size-4" aria-hidden="true" />
              {t('collectionPicker.enterToCreate', { name: query.trim() })}
            </li>
          )}
        </ul>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="button-secondary px-3 py-1.5" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button-primary px-3 py-1.5"
            disabled={checked.size === 0}
            onClick={confirm}
          >
            {t('collectionPicker.organize')}
          </button>
        </div>
      </div>
    </div>
  )
}
