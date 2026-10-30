import { FolderOpen, Library, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { CollectionDialog } from '../items/CollectionDialog'
import { collectionKind } from '../items/collectionKinds'
import { ItemList } from '../items/ItemList'
import { ItemListSkeleton } from '../items/ItemListSkeleton'
import { LoadMore } from '../items/LoadMore'
import { useCollections, useCreateCollection, useItems } from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { ViewModeSwitch } from '../items/ViewModeSwitch'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState } from '../ui/states'

export function CollectionsPage() {
  const collections = useCollections()
  const create = useCreateCollection()
  const { toast } = useFeedback()
  const [creating, setCreating] = useState(false)

  const newButton = (
    <button
      type="button"
      className="button-primary flex shrink-0 items-center gap-1.5"
      onClick={() => setCreating(true)}
    >
      <Plus className="size-4" aria-hidden="true" />
      New collection
    </button>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">Collections</h1>
        {collections.isSuccess && collections.data.length > 0 && newButton}
      </div>

      {collections.isPending && (
        <div role="status" aria-label="Loading collections" className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      )}
      {collections.isError && (
        <ErrorState error={collections.error} onRetry={() => collections.refetch()} />
      )}
      {collections.isSuccess && collections.data.length === 0 && (
        <EmptyState icon={Library} title="No collections yet" action={newButton}>
          A collection gathers what belongs together: a project, an area of your life, a topic.
          Create one here, or pick <strong>Organize</strong> on anything in the inbox.
        </EmptyState>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {collections.data?.map((collection) => {
          const { icon: Icon, label } = collectionKind(collection.kind)
          return (
            <li key={collection.id}>
              <Link
                to={`/collections/${collection.id}`}
                className="surface group flex items-center gap-3 px-3 py-3 transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-lg text-accent-600 transition group-hover:bg-accent-100 dark:bg-accent-500/10 dark:text-accent-300">
                  {collection.icon || <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{collection.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {label} · {collection.item_count}{' '}
                    {collection.item_count === 1 ? 'item' : 'items'}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {creating && (
        <CollectionDialog
          title="New collection"
          submitLabel="Create"
          saving={create.isPending}
          error={create.error?.message}
          onClose={() => {
            setCreating(false)
            create.reset()
          }}
          onSubmit={(draft) =>
            create.mutate(draft, {
              onSuccess: (collection) => {
                setCreating(false)
                toast({ message: `Created ${collection.name}` })
              },
            })
          }
        />
      )}
    </div>
  )
}

export function CollectionPage() {
  const { id = '' } = useParams()
  const collections = useCollections()
  const items = useItems({ collection: id })
  const collection = collections.data?.find((c) => c.id === id)
  const all = items.data?.pages.flatMap((page) => page.results) ?? []
  const [mode, setMode] = useViewMode('collection')
  const missing = collections.isSuccess && !collection
  const capture = useCapturePipeline()
  const pending = capture.pending.filter((entry) => entry.collection === id)

  // Pastes and drops while it is open land here, not in the inbox.
  const name = collection?.name
  const { destination } = capture
  useEffect(() => {
    if (name) return destination({ id, name })
  }, [destination, id, name])

  return (
    <div className={`mx-auto ${MODE_WIDTH[mode]} px-4 py-8 transition-[max-width]`}>
      <BackLink to="/collections" label="Collections" />
      <div className="mt-1 mb-4 flex items-center gap-2">
        <h1 className="mr-auto min-w-0 truncate text-2xl font-semibold">
          {collection ? (
            <>
              {collection.icon && <span className="mr-2">{collection.icon}</span>}
              {collection.name}
            </>
          ) : missing ? (
            'Collection'
          ) : (
            <span className="skeleton inline-block h-7 w-48 align-middle" aria-label="Loading" />
          )}
        </h1>
        {!missing && <ViewModeSwitch mode={mode} onChange={setMode} />}
      </div>
      {missing ? (
        <EmptyState
          icon={FolderOpen}
          title="This collection no longer exists"
          action={
            <Link to="/collections" className="button-primary">
              See all collections
            </Link>
          }
        />
      ) : (
        <>
          {items.isPending && <ItemListSkeleton mode={mode} />}
          {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
          {items.isSuccess && all.length === 0 && pending.length === 0 && (
            <EmptyState
              icon={FolderOpen}
              title="Nothing here yet"
              action={
                <Link to="/" className="button-outline">
                  Go to the inbox
                </Link>
              }
            >
              Paste or drop anything here, or pick <strong>Organize</strong> on an inbox item, to
              bring it into this collection.
            </EmptyState>
          )}
          {pending.length > 0 && (
            <ul className="mb-3 space-y-3" aria-label="Capturing">
              {pending.map((entry) => (
                <li key={entry.id}>
                  <PendingCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <ItemList items={all} backToInbox mode={mode} />
          {items.hasNextPage && (
            <LoadMore loading={items.isFetchingNextPage} onClick={() => items.fetchNextPage()} />
          )}
        </>
      )}
    </div>
  )
}
