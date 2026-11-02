import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Library,
  ListTree,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from 'lucide-react'
import { Fragment, useEffect, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useCapturePipeline } from '../capture/context'
import { PendingCard } from '../capture/PendingCard'
import { rich, useT } from '../i18n/i18n'
import { CollectionAvatar } from '../items/CollectionAvatar'
import { CollectionDialog } from '../items/CollectionDialog'
import { CollectionGrid } from '../items/CollectionGrid'
import {
  ancestorsOf,
  childrenOf,
  collectionSummary,
  withDescendants,
} from '../items/collectionTree'
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
  useMoveCollection,
  useUpdateCollection,
  type Collection,
  type Item,
  type OrphanAction,
} from '../items/api'
import { MODE_WIDTH, useViewMode } from '../items/viewMode'
import { ViewModeSwitch, type ModeOption } from '../items/ViewModeSwitch'
import { BackLink } from '../ui/BackLink'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState } from '../ui/states'
import { useViewer } from '../viewer/context'

/** How many of a collection's items the tree shows before pointing to its page. */
const TREE_ITEMS = 20

/** How long a dragged collection hovers over a closed one before it opens. */
const OPEN_ON_HOVER_MS = 600

type CollectionsView = 'tree' | 'grid'

const VIEWS: ModeOption<CollectionsView>[] = [
  { mode: 'tree', label: 'collections.tree', icon: ListTree },
  { mode: 'grid', label: 'collections.grid', icon: LayoutGrid },
]

const VIEW_KEY = 'brainbro:collections-view'

/** Tree or grid, remembered on this device. */
function useCollectionsView() {
  const [view, setView] = useState<CollectionsView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'tree'
    } catch {
      return 'tree'
    }
  })
  function choose(next: CollectionsView) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Blocked storage: it holds for this visit only.
    }
  }
  return [view, choose] as const
}

export function CollectionsPage() {
  const t = useT()
  const collections = useCollections()
  const { toast } = useFeedback()
  const [creating, setCreating] = useState(false)
  const [view, setView] = useCollectionsView()
  const some = collections.isSuccess && collections.data.length > 0

  const newButton = (
    <button
      type="button"
      className="button-primary flex shrink-0 items-center gap-1.5"
      onClick={() => setCreating(true)}
    >
      <Plus className="size-4" aria-hidden="true" />
      {t('collections.new')}
    </button>
  )

  return (
    <div className="px-4 py-8">
      {/* The header keeps one width; only the collections below follow the view. */}
      <div className="mx-auto mb-6 flex max-w-3xl items-center gap-2">
        <h1 className="mr-auto text-2xl font-semibold">{t('collections.title')}</h1>
        {some && <ViewModeSwitch mode={view} onChange={setView} modes={VIEWS} />}
        {some && newButton}
      </div>

      <div
        className={`mx-auto ${view === 'grid' ? 'max-w-6xl' : 'max-w-3xl'} transition-[max-width]`}
      >
        {collections.isPending && (
          <div role="status" aria-label={t('collections.loading')} className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        )}
        {collections.isError && (
          <ErrorState error={collections.error} onRetry={() => collections.refetch()} />
        )}
        {collections.isSuccess && collections.data.length === 0 && (
          <EmptyState icon={Library} title={t('collections.none')} action={newButton}>
            {rich('collections.noneHint', { b: (chunk) => <strong>{chunk}</strong> })}
          </EmptyState>
        )}
        {some &&
          (view === 'grid' ? (
            <CollectionGrid collections={collections.data} parent={null} label={t('collections.title')} />
          ) : (
            <CollectionTree collections={collections.data} />
          ))}
      </div>

      {creating && (
        <CollectionDialog
          onClose={() => setCreating(false)}
          onSaved={(collection) => {
            setCreating(false)
            toast({ message: t('collections.created', { name: collection.name }) })
          }}
        />
      )}
    </div>
  )
}

/** Indents a tree row by its depth. */
function indent(depth: number) {
  return { paddingLeft: `${depth * 1.25 + 0.25}rem` }
}

/** Where a dragged collection would land, next to a row or inside it. */
type DropZone = 'before' | 'after' | 'inside'

type TreeDrag = ReturnType<typeof useTreeDrag>

/**
 * Sorting the tree: a collection dragged onto the top or bottom edge of a row
 * goes before or after it, onto its middle inside it. Alt+↑/↓ moves the
 * focused one among the collections next to it.
 */
function useTreeDrag(collections: Collection[]) {
  const move = useMoveCollection()
  const { toast } = useFeedback()
  const [dragging, setDragging] = useState<string | null>(null)
  const [target, setTarget] = useState<{ id: string; zone: DropZone } | null>(null)

  /** Puts `id` inside `parent`, right after `after` (null: first), unless it's there. */
  function place(id: string, parent: string | null, after: string | null) {
    const siblings = childrenOf(collections, parent)
    const index = siblings.findIndex((collection) => collection.id === id)
    if (index >= 0 && (siblings[index - 1]?.id ?? null) === after) return
    move.mutate(
      { id, parent, after },
      { onError: (error) => toast({ message: error.message, tone: 'error' }) },
    )
  }

  function end() {
    setDragging(null)
    setTarget(null)
  }

  return {
    dragging,
    target,
    start(event: DragEvent, id: string) {
      setDragging(id)
      event.dataTransfer.effectAllowed = 'move'
    },
    over(event: DragEvent, collection: Collection, open: boolean) {
      // Only our own drags; files from outside are captures.
      if (!dragging) return
      event.stopPropagation()
      // Not into itself, or anywhere among its own.
      if (withDescendants(collections, dragging).has(collection.id)) {
        setTarget(null)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const y = (event.clientY - rect.top) / rect.height
      let zone: DropZone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
      // Right below an open one is the top of what's inside it.
      if (zone === 'after' && open) zone = 'inside'
      if (target?.id !== collection.id || target.zone !== zone) {
        setTarget({ id: collection.id, zone })
      }
    },
    /** Over something that isn't a row: nowhere to drop. */
    leave() {
      if (target) setTarget(null)
    },
    drop() {
      const row = target && collections.find((collection) => collection.id === target.id)
      if (dragging && target && row) {
        if (target.zone === 'inside') {
          place(dragging, row.id, null)
        } else {
          const parent = row.parent ?? null
          const siblings = childrenOf(collections, parent).filter(
            (collection) => collection.id !== dragging,
          )
          const before = siblings[siblings.indexOf(row) - 1]?.id ?? null
          place(dragging, parent, target.zone === 'after' ? row.id : before)
        }
      }
      end()
    },
    end,
    keyDown(event: KeyboardEvent, collection: Collection) {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const parent = collection.parent ?? null
      const siblings = childrenOf(collections, parent)
      const index = siblings.indexOf(collection)
      if (event.key === 'ArrowUp' && index > 0) {
        place(collection.id, parent, siblings[index - 2]?.id ?? null)
      } else if (event.key === 'ArrowDown' && index < siblings.length - 1) {
        place(collection.id, parent, siblings[index + 1].id)
      } else {
        return
      }
      // Moving the row in the page drops its focus: give it back.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-collection="${collection.id}"]`)?.focus(),
      )
    },
  }
}

/** The collections as a tree, sorted by dragging. */
function CollectionTree({ collections }: { collections: Collection[] }) {
  const t = useT()
  const drag = useTreeDrag(collections)
  return (
    <ul
      aria-label={t('collections.title')}
      className="surface p-1.5"
      onDragOver={drag.leave}
      onDrop={(event) => {
        if (drag.dragging) event.preventDefault()
      }}
    >
      {childrenOf(collections, null).map((collection) => (
        <CollectionNode
          key={collection.id}
          collection={collection}
          collections={collections}
          depth={0}
          drag={drag}
        />
      ))}
    </ul>
  )
}

/**
 * A collection in the tree: its row, and once opened the collections inside
 * it, then its items. Items load only when it is opened.
 */
function CollectionNode({
  collection,
  collections,
  depth,
  drag,
}: {
  collection: Collection
  collections: Collection[]
  depth: number
  drag: TreeDrag
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const inside = childrenOf(collections, collection.id)
  const opens = inside.length > 0 || collection.item_count > 0
  const zone = drag.target?.id === collection.id ? drag.target.zone : null

  // Held over a closed one: it opens, to drop among what's inside.
  useEffect(() => {
    if (zone !== 'inside' || open || !opens) return
    const timer = setTimeout(() => setOpen(true), OPEN_ON_HOVER_MS)
    return () => clearTimeout(timer)
  }, [zone, open, opens])

  return (
    <li>
      <div
        className={`relative flex items-center gap-1 rounded-lg pr-2 transition ${
          zone === 'inside'
            ? 'bg-accent-50 ring-2 ring-accent-500 ring-inset dark:bg-accent-500/10'
            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
        } ${drag.dragging === collection.id ? 'opacity-40' : ''}`}
        style={indent(depth)}
        draggable
        onDragStart={(event) => drag.start(event, collection.id)}
        onDragOver={(event) => drag.over(event, collection, open && opens)}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          drag.drop()
        }}
        onDragEnd={drag.end}
      >
        {(zone === 'before' || zone === 'after') && (
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-2 h-0.5 rounded-full bg-accent-500 ${
              zone === 'before' ? '-top-px' : '-bottom-px'
            }`}
            // From the name on, at this row's depth.
            style={{ left: `${depth * 1.25 + 2.25}rem` }}
          />
        )}
        {opens ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t(open ? 'collections.close' : 'collections.open', { name: collection.name })}
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
          // The row moves, not the link.
          draggable={false}
          data-collection={collection.id}
          className="flex min-w-0 flex-1 items-center gap-3 py-1.5"
          onKeyDown={(event) => drag.keyDown(event, collection)}
        >
          <CollectionAvatar collection={collection} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{collection.name}</span>
            <span className="block truncate text-xs text-zinc-500">
              {collectionSummary(collections, collection)}
            </span>
          </span>
        </Link>
      </div>
      {open && (
        <ul aria-label={t('collections.inside', { name: collection.name })}>
          {inside.map((child) => (
            <CollectionNode
              key={child.id}
              collection={child}
              collections={collections}
              depth={depth + 1}
              drag={drag}
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
  const t = useT()
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
      <li role="status" aria-label={t('collections.loadingNamed', { name: collection.name })} className={row} style={style}>
        <span className="skeleton size-8 rounded-lg" />
        <span className="skeleton h-4 w-40" />
      </li>
    )
  }
  if (items.isError) {
    return (
      <li className={`${row} text-red-600 dark:text-red-400`} style={style}>
        {t('collections.couldNotLoadItems')}
        <button type="button" className="button-ghost" onClick={() => items.refetch()}>
          {t('card.retry')}
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
            {t('collections.more', { count: more, name: collection.name })}
          </Link>
        </li>
      )}
    </>
  )
}

export function CollectionPage() {
  const t = useT()
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
    <div className="px-4 py-8">
      {/* The header keeps one width; only what is below follows the view mode. */}
      <div className={`mx-auto ${MODE_WIDTH.cards}`}>
        {ancestors.length === 0 ? (
          <BackLink to="/collections" label={t('collections.title')} />
        ) : (
          <nav
            aria-label={t('collections.breadcrumb')}
            className="flex min-w-0 items-center gap-0.5 text-sm"
          >
            <BackLink to="/collections" label={t('collections.title')} />
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
              t('collections.collection')
            ) : (
              <span
                className="skeleton inline-block h-7 w-48 align-middle"
                aria-label={t('common.loading')}
              />
            )}
          </h1>
          {collection && (
            <>
              <Link
                to={`/collections/${id}/mindmap`}
                aria-label={t('collections.mindMap')}
                className="button-icon group/tip"
              >
                <Workflow className="size-4" aria-hidden="true" />
                <span className="tooltip top-full mt-1.5">{t('collections.mindMap')}</span>
              </Link>
              <button
                type="button"
                aria-label={t('collections.newInside')}
                className="button-icon group/tip"
                onClick={() => setAdding(true)}
              >
                <FolderPlus className="size-4" aria-hidden="true" />
                <span className="tooltip top-full mt-1.5">{t('collections.newInside')}</span>
              </button>
              <button
                type="button"
                aria-label={t('collections.edit')}
                className="button-icon group/tip"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                <span className="tooltip top-full mt-1.5">{t('collections.edit')}</span>
              </button>
              <button
                type="button"
                aria-label={t('collections.delete')}
                className="button-icon group/tip"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="tooltip top-full mt-1.5">{t('collections.delete')}</span>
              </button>
            </>
          )}
          {!missing && <ViewModeSwitch mode={mode} onChange={setMode} />}
        </div>
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
            toast({
              message: t('collections.createdIn', { name: created.name, parent: collection.name }),
            })
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
                  toast({ message: t('collections.deleted', { name: collection.name }) })
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
      <div className={`mx-auto ${MODE_WIDTH[mode]} transition-[max-width]`}>
        {missing ? (
          <EmptyState
            icon={FolderOpen}
            title={t('collections.gone')}
            action={
              <Link to="/collections" className="button-primary">
                {t('collections.seeAll')}
              </Link>
            }
          />
        ) : (
          <>
            {collections.isSuccess && inside.length > 0 && (
              <div className="mb-4">
                <CollectionGrid
                  collections={collections.data}
                  parent={id}
                  label={t('collections.collectionsInside')}
                />
              </div>
            )}
            {items.isPending && <ItemListSkeleton mode={mode} />}
            {items.isError && <ErrorState error={items.error} onRetry={() => items.refetch()} />}
            {items.isSuccess && all.length === 0 && pending.length === 0 && inside.length === 0 && (
              <EmptyState
                icon={FolderOpen}
                title={t('collections.empty')}
                action={
                  <Link to="/" className="button-outline">
                    {t('collections.toInbox')}
                  </Link>
                }
              >
                {rich('collections.emptyHint', { b: (chunk) => <strong>{chunk}</strong> })}
              </EmptyState>
            )}
            {pending.length > 0 && (
              <ul className="mb-3 space-y-3" aria-label={t('inbox.capturing')}>
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
    </div>
  )
}

/** The collection's name, as a field: click it to rename, Esc to leave it. */
function NameField({ collection }: { collection: Collection }) {
  const t = useT()
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
        aria-label={t('collections.name')}
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
