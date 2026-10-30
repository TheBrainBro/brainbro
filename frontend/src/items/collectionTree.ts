import type { Collection } from './api'

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
