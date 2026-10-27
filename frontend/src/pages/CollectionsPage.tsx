import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { ItemList } from '../items/ItemList'
import { useCollections, useCreateCollection, useItems, type CollectionKind } from '../items/api'

const kinds: { value: CollectionKind; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'area', label: 'Area' },
  { value: 'personal', label: 'Personal' },
]

export function CollectionsPage() {
  const collections = useCollections()
  const create = useCreateCollection()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CollectionKind>('project')

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-3 text-2xl font-semibold">Collections</h1>
      <form
        className="mb-6 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          create.mutate({ name: name.trim(), kind }, { onSuccess: () => setName('') })
        }}
      >
        <input
          className="input"
          aria-label="New collection"
          placeholder="New collection"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="input w-auto"
          aria-label="Kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as CollectionKind)}
        >
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          disabled={!name.trim() || create.isPending}
        >
          Add
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="-mt-4 mb-4 text-sm text-red-600">
          {create.error.message}
        </p>
      )}

      {collections.isSuccess && collections.data.length === 0 && (
        <p className="text-zinc-500">No collections yet. Create one, or organize an inbox item.</p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {collections.data?.map((collection) => (
          <li key={collection.id}>
            <Link
              to={`/collections/${collection.id}`}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <span className="truncate font-medium">
                {collection.icon && <span className="mr-1">{collection.icon}</span>}
                {collection.name}
              </span>
              <span className="ml-2 shrink-0 text-xs text-zinc-400">
                {collection.kind} · {collection.item_count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CollectionPage() {
  const { id = '' } = useParams()
  const collections = useCollections()
  const items = useItems({ collection: id })
  const collection = collections.data?.find((c) => c.id === id)
  const all = items.data?.pages.flatMap((page) => page.results) ?? []

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/collections" className="text-sm text-zinc-500 hover:underline">
        ← Collections
      </Link>
      <h1 className="mt-1 mb-4 text-2xl font-semibold">{collection?.name ?? 'Collection'}</h1>
      {items.isSuccess && all.length === 0 && <p className="text-zinc-500">Nothing here yet.</p>}
      <ItemList items={all} backToInbox />
      {items.hasNextPage && (
        <button
          type="button"
          className="mt-4 w-full rounded-lg py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          disabled={items.isFetchingNextPage}
          onClick={() => items.fetchNextPage()}
        >
          {items.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
