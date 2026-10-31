import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Library,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { CollectionAvatar } from '../items/CollectionAvatar'
import { CollectionDialog } from '../items/CollectionDialog'
import { collectionKind } from '../items/collectionKinds'
import { ancestorsOf, childrenOf } from '../items/collectionTree'
import { ItemList } from '../items/ItemList'
import { ItemListSkeleton } from '../items/ItemListSkeleton'
import { ItemThumb } from '../items/ItemThumb'
import { itemLabel } from '../items/label'
import { LoadMore } from '../items/LoadMore'
import { DeleteCollectionDialog } from '../items/DeleteCollectionDialog'
import {
  useCollections,
  useDeleteCollection,
  useItems,
  useUpdateCollection,
  type Collection,
  type Item,
  type OrphanAction,
} from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { ViewModeSwitch } from '../items/ViewModeSwitch'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState } from '../ui/states'
import { useViewer } from '../viewer/context'

/** How many of a collection's items the tree shows before pointing to its page. */
const TREE_ITEMS = 20

export function CollectionsPage() {
  const collections = useCollections()
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
      {collections.isSuccess && collections.data.length > 0 && (
        <ul aria-label="Collections" className="surface p-1.5">
          {childrenOf(collections.data, null).map((collection) => (
            <CollectionNode
              key={collection.id}
              collection={collection}
              collections={collections.data}
              depth={0}
            />
          ))}
        </ul>
      )}

      {creating && (
        <CollectionDialog
          onClose={() => setCreating(false)}
          onSaved={(collection) => {
            setCreating(false)
            toast({ message: `Created ${collection.name}` })
          }}
        />
      )}
    </div>
  )
}

/** "Project · 3 items · 2 collections": what a collection is and holds. */
function summary(collection: Collection, inside: number) {
  const parts = [
    collectionKind(collection.kind).label,
    `${collection.item_count} ${collection.item_count === 1 ? 'item' : 'items'}`,
  ]
  if (inside) parts.push(`${inside} ${inside === 1 ? 'collection' : 'collections'}`)
  return parts.join(' · ')
}

/** Indents a tree row by its depth. */
function indent(depth: number) {
  return { paddingLeft: `${depth * 1.25 + 0.25}rem` }
}

/**
 * A collection in the tree: its row, and once opened the collections inside
 * it, then its items. Items load only when it is opened.
 */
function CollectionNode({
  collection,
  collections,
  depth,
}: {
  collection: Collection
  collections: Collection[]
  depth: number
}) {
  const [open, setOpen] = useState(false)
  const inside = childrenOf(collections, collection.id)
  const opens = inside.length > 0 || collection.item_count > 0

  return (
    <li>
      <div
        className="flex items-center gap-1 rounded-lg pr-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
        style={indent(depth)}
      >
        {opens ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Close' : 'Open'} ${collection.name}`}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
            onClick={() => setOpen(!open)}
          >
            <ChevronRight
              className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="size-7 shrink-0" />
        )}
        <Link
          to={`/collections/${collection.id}`}
          className="flex min-w-0 flex-1 items-center gap-3 py-1.5"
        >
          <CollectionAvatar collection={collection} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{collection.name}</span>
            <span className="block truncate text-xs text-zinc-500">
              {summary(collection, inside.length)}
            </span>
          </span>
        </Link>
      </div>
      {open && (
        <ul aria-label={`In ${collection.name}`}>
          {inside.map((child) => (
            <CollectionNode
              key={child.id}
              collection={child}
              collections={collections}
              depth={depth + 1}
            />
          ))}
          {collection.item_count > 0 && <TreeItems collection={collection} depth={depth + 1} />}
        </ul>
      )}
    </li>
  )
}

/** A collection's items in the tree: a short list; its page has the rest. */
function TreeItems({ collection, depth }: { collection: Collection; depth: number }) {
  const items = useItems({ collection: collection.id })
  const navigate = useNavigate()
  const viewer = useViewer()
  const all = items.data?.pages.flatMap((page) => page.results) ?? []
  const shown = all.slice(0, TREE_ITEMS)
  const more = collection.item_count - shown.length

  function open(item: Item) {
    if (item.kind === 'note') navigate(`/notes/${item.id}`)
    else viewer.open(shown, shown.indexOf(item))
  }

  const row = 'flex items-center gap-3 rounded-lg py-1 pr-2 text-sm'
  // Lines up with the collection names: past the chevron's column.
  const style = { paddingLeft: `${depth * 1.25 + 2.25}rem` }

  if (items.isPending) {
    return (
      <li role="status" aria-label={`Loading ${collection.name}`} className={row} style={style}>
        <span className="skeleton size-8 rounded-lg" />
        <span className="skeleton h-4 w-40" />
      </li>
    )
  }
  if (items.isError) {
    return (
      <li className={`${row} text-red-600 dark:text-red-400`} style={style}>
        Couldn't load these items.
        <button type="button" className="button-ghost" onClick={() => items.refetch()}>
          Retry
        </button>
      </li>
    )
  }
  return (
    <>
      {shown.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={`${row} w-full text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800/60`}
            style={style}
            onClick={() => open(item)}
          >
            <ItemThumb item={item} className="size-8" />
            <span className="min-w-0 flex-1 truncate">{itemLabel(item)}</span>
          </button>
        </li>
      ))}
      {more > 0 && (
        <li className={row} style={style}>
          <Link
            to={`/collections/${collection.id}`}
            className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-300"
          >
            {more} more in {collection.name}
          </Link>
        </li>
      )}
    </>
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
  const remove = useDeleteCollection()
  const navigate = useNavigate()
  const { toast } = useFeedback()
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [adding, setAdding] = useState(false)
  const capture = useCapturePipeline()
  const pending = capture.pending.filter((entry) => entry.collection === id)
  const ancestors = ancestorsOf(collections.data ?? [], id)
  const inside = childrenOf(collections.data ?? [], id)

  // Pastes and drops while it is open land here, not in the inbox.
  const name = collection?.name
  const { destination } = capture
  useEffect(() => {
    if (name) return destination({ id, name })
  }, [destination, id, name])

  return (
    <div className={`mx-auto ${MODE_WIDTH[mode]} px-4 py-8 transition-[max-width]`}>
      {ancestors.length === 0 ? (
        <BackLink to="/collections" label="Collections" />
      ) : (
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-0.5 text-sm">
          <BackLink to="/collections" label="Collections" />
          {ancestors.map((ancestor) => (
            <Fragment key={ancestor.id}>
              <ChevronRight className="size-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
              <Link
                to={`/collections/${ancestor.id}`}
                className="min-w-0 truncate rounded-md px-1.5 py-1 font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {ancestor.name}
              </Link>
            </Fragment>
          ))}
        </nav>
      )}
      <div className="mt-1 mb-4 flex items-center gap-2">
        <h1
          className="mr-auto min-w-0 flex-1 truncate text-2xl font-semibold"
          aria-label={collection?.name}
        >
          {collection ? (
            <span className="flex items-center gap-3">
              <CollectionAvatar collection={collection} />
              <NameField key={`${collection.id}:${collection.name}`} collection={collection} />
            </span>
          ) : missing ? (
            'Collection'
          ) : (
            <span className="skeleton inline-block h-7 w-48 align-middle" aria-label="Loading" />
          )}
        </h1>
        {collection && (
          <>
            <Link
              to={`/collections/${id}/mindmap`}
              aria-label="Mind map"
              className="button-icon group/tip"
            >
              <Workflow className="size-4" aria-hidden="true" />
              <span className="tooltip top-full mt-1.5">Mind map</span>
            </Link>
            <button
              type="button"
              aria-label="New collection inside"
              className="button-icon group/tip"
              onClick={() => setAdding(true)}
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              <span className="tooltip top-full mt-1.5">New collection inside</span>
            </button>
            <button
              type="button"
              aria-label="Edit collection"
              className="button-icon group/tip"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" aria-hidden="true" />
              <span className="tooltip top-full mt-1.5">Edit collection</span>
            </button>
            <button
              type="button"
              aria-label="Delete collection"
              className="button-icon group/tip"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="tooltip top-full mt-1.5">Delete collection</span>
            </button>
          </>
        )}
        {!missing && <ViewModeSwitch mode={mode} onChange={setMode} />}
      </div>
      {editing && collection && (
        <CollectionDialog
          collection={collection}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {adding && collection && (
        <CollectionDialog
          parent={collection.id}
          onClose={() => setAdding(false)}
          onSaved={(created) => {
            setAdding(false)
            toast({ message: `Created ${created.name} in ${collection.name}` })
          }}
        />
      )}
      {deleting && collection && (
        <DeleteCollectionDialog
          collection={collection}
          deleting={remove.isPending}
          onClose={() => setDeleting(false)}
          onDelete={(items: OrphanAction) =>
            remove.mutate(
              { id, items },
              {
                onSuccess: () => {
                  toast({ message: `Deleted ${collection.name}` })
                  navigate(collection.parent ? `/collections/${collection.parent}` : '/collections')
                },
                onError: (error) => {
                  setDeleting(false)
                  toast({ message: error.message, tone: 'error' })
                },
              },
            )
          }
        />
      )}
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
          {inside.length > 0 && (
            <ul aria-label="Collections inside" className="mb-4 grid gap-2 sm:grid-cols-2">
              {inside.map((child) => (
                <li key={child.id}>
                  <Link
                    to={`/collections/${child.id}`}
                    className="surface flex items-center gap-3 px-3 py-2.5 transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700"
                  >
                    <CollectionAvatar collection={child} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{child.name}</span>
                      <span className="block truncate text-xs text-zinc-500">
                        {summary(child, childrenOf(collections.data ?? [], child.id).length)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {items.isPending && <ItemListSkeleton mode={mode} />}
          {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
          {items.isSuccess && all.length === 0 && pending.length === 0 && inside.length === 0 && (
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
          <ItemList items={all} backToInbox mode={mode} sortable={{ collection: id }} />
          {items.hasNextPage && (
            <LoadMore loading={items.isFetchingNextPage} onClick={() => items.fetchNextPage()} />
          )}
        </>
      )}
    </div>
  )
}

/** The collection's name, as a field: click it to rename, Esc to leave it. */
function NameField({ collection }: { collection: Collection }) {
  const update = useUpdateCollection()
  const [name, setName] = useState(collection.name)

  function save() {
    const next = name.trim()
    if (!next) setName(collection.name)
    else if (next !== collection.name) update.mutate({ id: collection.id, name: next })
  }

  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <input
        aria-label="Collection name"
        className="-ml-2 w-full min-w-0 truncate rounded-md bg-transparent px-2 py-0.5 transition hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setName(collection.name)
            // Blurring now would save the old name as it was: nothing to do.
            requestAnimationFrame(() => (event.target as HTMLInputElement).blur())
          }
        }}
      />
      {update.isError && (
        <span role="alert" className="text-xs font-normal text-red-600 dark:text-red-400">
          {update.error.message}
        </span>
      )}
    </span>
  )
}
