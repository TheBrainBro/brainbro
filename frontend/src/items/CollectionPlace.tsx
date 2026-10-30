import type { Collection } from './api'
import { collectionPath } from './collectionTree'

/** Where a collection sits ("Work / Clients"), muted, after its name in lists. */
export function CollectionPlace({ collections, id }: { collections: Collection[]; id: string }) {
  const path = collectionPath(collections, id)
  return path ? <span className="truncate text-xs text-zinc-400">{path}</span> : null
}
