import type { Collection } from './api'
import { collectionKind } from './collectionKinds'

/** The collections directly inside `parent` (null: at the top), in list order. */
export function childrenOf(collections: Collection[], parent: string | null) {
  return collections.filter((collection) => (collection.parent ?? null) === parent)
}

/** The collections `id` sits in, from the top down. */
export function ancestorsOf(collections: Collection[], id: string) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  const path: Collection[] = []
  let parent = byId.get(id)?.parent
  // A loop can't be saved, but a stale cache shouldn't hang the page either.
  while (parent && parent !== id && !path.some((collection) => collection.id === parent)) {
    const collection = byId.get(parent)
    if (!collection) break
    path.unshift(collection)
    parent = collection.parent
  }
  return path
}

/** `id` and every collection inside it, at any depth. */
export function withDescendants(collections: Collection[], id: string) {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const collection of collections) {
      if (collection.parent && ids.has(collection.parent) && !ids.has(collection.id)) {
        ids.add(collection.id)
        grew = true
      }
    }
  }
  return ids
}

/** Where a collection sits, as "Work / Clients"; empty at the top. */
export function collectionPath(collections: Collection[], id: string) {
  return ancestorsOf(collections, id)
    .map((collection) => collection.name)
    .join(' / ')
}

/**
 * `collections` with `id` inside `parent` (null: at the top), right after
 * `after` there (null: first). The list keeps every level in order, so it
 * goes next to `after`, or before the first collection already there.
 */
export function moveCollection(
  collections: Collection[],
  id: string,
  parent: string | null,
  after: string | null,
) {
  const moving = collections.find((collection) => collection.id === id)
  if (!moving) return collections
  const rest = collections.filter((collection) => collection !== moving)
  const at = after
    ? rest.findIndex((collection) => collection.id === after) + 1
    : rest.findIndex((collection) => (collection.parent ?? null) === parent)
  rest.splice(at < 0 ? rest.length : at, 0, { ...moving, parent })
  return rest
}

/** "Project · 3 items · 2 collections": what a collection is and holds. */
export function collectionSummary(collections: Collection[], collection: Collection) {
  const inside = childrenOf(collections, collection.id).length
  const parts = [
    collectionKind(collection.kind).label,
    `${collection.item_count} ${collection.item_count === 1 ? 'item' : 'items'}`,
  ]
  if (inside) parts.push(`${inside} ${inside === 1 ? 'collection' : 'collections'}`)
  return parts.join(' · ')
}
