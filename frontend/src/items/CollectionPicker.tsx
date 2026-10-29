import { useState } from 'react'

import { useCollections, useCreateCollection } from './api'

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
  onConfirm: (collectionIds: string[]) => void
  onClose: () => void
}) {
  const collections = useCollections()
  const create = useCreateCollection()
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const all = collections.data ?? []
  const needle = query.trim().toLowerCase()
  const visible = needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all
  const exact = all.find((c) => c.name.toLowerCase() === needle)

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onEnter() {
    if (!needle) {
      if (checked.size) onConfirm([...checked])
      return
    }
    if (exact) {
      toggle(exact.id)
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
      className="fixed inset-0 z-30 flex items-start justify-center bg-zinc-950/30 p-4 pt-[15vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Organize into collections"
        className="popover w-full max-w-sm p-3"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <p className="px-1 pb-2 text-sm text-zinc-500">
          Organize {count === 1 ? '1 item' : `${count} items`} into…
        </p>
        <input
          className="input"
          placeholder="Find or create a collection"
          aria-label="Find or create a collection"
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
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={checked.has(collection.id)}
                  onChange={() => toggle(collection.id)}
                />
                <span className="flex-1 truncate">
                  {collection.icon && <span className="mr-1">{collection.icon}</span>}
                  {collection.name}
                </span>
                <span className="text-xs text-zinc-400">{collection.item_count}</span>
              </label>
            </li>
          ))}
          {needle && !exact && (
            <li className="px-2 py-1.5 text-sm text-zinc-500">
              Enter to create “{query.trim()}”
            </li>
          )}
        </ul>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="rounded-lg px-3 py-1.5 text-sm text-zinc-500" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button-primary px-3 py-1.5"
            disabled={checked.size === 0}
            onClick={() => onConfirm([...checked])}
          >
            Organize
          </button>
        </div>
      </div>
    </div>
  )
}
