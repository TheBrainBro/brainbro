import { useMemo } from 'react'
import { Link } from 'react-router'

import { useFeedback } from '../ui/feedback'
import { useSortable } from '../ui/sortable'
import { useMoveCollection, type Collection } from './api'
import { CollectionAvatar } from './CollectionAvatar'
import { childrenOf, collectionSummary } from './collectionTree'

/**
 * The collections side by side in `parent` (null: at the top), as cards:
 * drag them, or Alt+arrows, to sort them.
 */
export function CollectionGrid({
  collections,
  parent,
  label,
}: {
  collections: Collection[]
  parent: string | null
  label: string
}) {
  const move = useMoveCollection()
  const { toast } = useFeedback()
  // The same list until the collections change: dragging keeps its order for it.
  const here = useMemo(() => childrenOf(collections, parent), [collections, parent])
  const sorted = useSortable(here, (id, after) =>
    move.mutate(
      { id, parent, after },
      { onError: (error) => toast({ message: error.message, tone: 'error' }) },
    ),
  )

  return (
    // Columns follow the room it has, not the window: pages differ in width.
    <div className="@container">
      <ul
        aria-label={label}
        className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5"
        {...sorted.listProps}
      >
        {sorted.shown.map((collection) => (
          <li key={collection.id} {...sorted.itemProps(collection)}>
            <Link
              to={`/collections/${collection.id}`}
              // The card moves, not the link.
              draggable={false}
              className="surface flex h-full flex-col gap-3 p-4 transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700"
            >
              <CollectionAvatar collection={collection} size="lg" />
              <span className="min-w-0">
                <span className="line-clamp-2 font-medium">{collection.name}</span>
                <span className="mt-0.5 block truncate text-xs text-zinc-500">
                  {collectionSummary(collections, collection)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
