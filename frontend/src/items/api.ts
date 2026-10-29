import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'

import { api } from '../lib/api'

export type ItemKind = 'note' | 'link' | 'image' | 'file' | 'album'
export type ItemStatus = 'inbox' | 'organized' | 'archived'
export type PreviewStatus = '' | 'pending' | 'ready' | 'failed'

export type ItemMetadata = {
  // Links
  title?: string
  description?: string
  site_name?: string
  author?: string
  favicon_url?: string
  final_url?: string
  image_url?: string
  preview_error?: string
  // Uploads (images and files)
  filename?: string
  mime?: string
  size?: number
  width?: number
  height?: number
}

export type Item = {
  id: string
  kind: ItemKind
  status: ItemStatus
  title: string
  body: string
  url: string
  metadata: ItemMetadata
  preview_status: PreviewStatus
  preview_image_url: string | null
  file_url: string | null
  collections: string[]
  /** The album this image is in, if any (it then only shows up through it). */
  album?: string | null
  /** Albums only: their images, in order. */
  album_items?: Item[] | null
  /** Notes only: the stored copy of each image, by its `src` as in the Markdown. */
  images?: NoteImages | null
  /** Fingerprint of title and body, sent back as If-Match when saving. */
  version: string
  created_at: string
  updated_at: string
}

/** A copy the app keeps of an image in a note; `url` once it is ready. */
export type NoteImage = { status: PreviewStatus; url: string | null }
export type NoteImages = Record<string, NoteImage>

/** Something about the item is still being made in the background. */
export function isProcessing(item: Item) {
  return (
    item.preview_status === 'pending' ||
    Object.values(item.images ?? {}).some((image) => image.status === 'pending')
  )
}

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

const PAGE_SIZE = 50
const PREVIEW_POLL_MS = 2000

export const itemsKey = ['items']

export type ItemFilters = {
  status?: ItemStatus
  collection?: string
  kind?: ItemKind
  /** Search text: every word must match (typos allowed); sorted by relevance. */
  q?: string
}

export function useItems(filters: ItemFilters) {
  return useInfiniteQuery({
    queryKey: [...itemsKey, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) })
      if (filters.status) params.set('status', filters.status)
      if (filters.collection) params.set('collection', filters.collection)
      if (filters.kind) params.set('kind', filters.kind)
      if (filters.q) params.set('q', filters.q)
      return api<Page<Item>>(`/items/?${params}`)
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.next ? pages.length * PAGE_SIZE : undefined),
    // Previews, thumbnails and note images are made in the background:
    // poll until none is pending.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.results.some(isProcessing))
        ? PREVIEW_POLL_MS
        : false,
  })
}

/** A search match; an album's image shows up as its album, saying which image. */
export type SearchResult = { item: Item; album_image: string | null }

/** The best matches for `q` (archived included); the last results stay while typing. */
export function useSearch(q: string) {
  return useQuery({
    queryKey: [...itemsKey, 'search', q],
    queryFn: () => api<SearchResult[]>(`/items/search/?${new URLSearchParams({ q })}`),
    enabled: Boolean(q),
    placeholderData: keepPreviousData,
  })
}

export const itemKey = (id: string) => [...itemsKey, 'detail', id]

/**
 * One item, refetched when the window regains focus so other tabs' edits
 * show up, and while its note images are being fetched.
 */
export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: itemKey(id ?? ''),
    queryFn: () => api<Item>(`/items/${id}/`),
    enabled: Boolean(id),
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.data && isProcessing(query.state.data) ? PREVIEW_POLL_MS : false,
  })
}

/** An image pasted or dropped into a note: uploaded first, then linked by `src`. */
export type UploadedNoteImage = { id: string; src: string; status: PreviewStatus; url: string | null }

export function uploadNoteImage(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api<UploadedNoteImage>('/note-images/', { method: 'POST', body: form })
}

/** Saves a note's body unless someone else saved since `version` (412, with their item). */
export function updateNoteBody(
  id: string,
  body: string,
  version: string,
  { keepalive = false } = {},
) {
  return api<Item>(`/items/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
    headers: { 'If-Match': `"${version}"` },
    keepalive,
  })
}

/** Puts a newer copy of an item into every cached list and its detail. */
function patchCachedItem(queryClient: QueryClient, item: Item) {
  queryClient.setQueriesData({ queryKey: itemsKey }, (data: unknown) => {
    if (data && typeof data === 'object' && 'pages' in data) {
      const lists = data as InfiniteData<Page<Item>>
      return {
        ...lists,
        pages: lists.pages.map((page) => ({
          ...page,
          results: page.results.map((cached) => (cached.id === item.id ? item : cached)),
        })),
      }
    }
    return (data as Item | undefined)?.id === item.id ? item : data
  })
}

/** Saves a new body from a card (ticking a task), shown at once. */
export function useSaveNoteBody() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ item, body }: { item: Item; body: string }) =>
      updateNoteBody(item.id, body, item.version),
    onMutate: ({ item, body }) => patchCachedItem(queryClient, { ...item, body }),
    onSuccess: (saved) => patchCachedItem(queryClient, saved),
    // Changed elsewhere (412) or failed: show what the server has.
    onError: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  })
}

/** The list an item is moved within: a collection, or else the inbox. */
export type MoveTarget = { collection?: string }

/** Its list as cached: the same filters the inbox and collection pages ask with. */
function listKey({ collection }: MoveTarget) {
  return [...itemsKey, collection ? { collection } : { status: 'inbox' }]
}

/**
 * Puts an item right after `after` (null: on top) in the inbox or a
 * collection, shown at once.
 */
export function useMoveItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, after, collection }: { id: string; after: string | null } & MoveTarget) =>
      api<void>(`/items/${id}/move/`, {
        method: 'POST',
        body: JSON.stringify({ after, ...(collection ? { collection } : {}) }),
      }),
    onMutate: ({ id, after, collection }) => {
      queryClient.setQueryData(listKey({ collection }), (data: InfiniteData<Page<Item>> | undefined) => {
        if (!data) return data
        const all = data.pages.flatMap((page) => page.results)
        const moving = all.find((item) => item.id === id)
        if (!moving) return data
        const rest = all.filter((item) => item !== moving)
        rest.splice(after ? rest.findIndex((item) => item.id === after) + 1 : 0, 0, moving)
        // Same pages, same sizes: only the order changes.
        let start = 0
        const pages = data.pages.map((page) => {
          const results = rest.slice(start, start + page.results.length)
          start += page.results.length
          return { ...page, results }
        })
        return { ...data, pages }
      })
    },
    onSettled: (_data, _error, { collection }) =>
      queryClient.invalidateQueries({ queryKey: listKey({ collection }) }),
  })
}

export function useRefreshPreview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<Item>(`/items/${id}/refresh-preview/`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  })
}

export type TriageAction = 'organize' | 'archive' | 'inbox' | 'delete'

export type TriagePayload = { ids: string[]; action: TriageAction; collections?: string[] }

export function triageItems(payload: TriagePayload) {
  return api<unknown>('/items/triage/', { method: 'POST', body: JSON.stringify(payload) })
}

export function useTriage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: triageItems,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey })
      queryClient.invalidateQueries({ queryKey: collectionsKey })
    },
  })
}

export type CollectionKind = 'project' | 'area' | 'resource'

export type Collection = {
  id: string
  name: string
  kind: CollectionKind
  /** Hex color behind the emoji, optional. */
  color: string
  /** An emoji, optional. */
  icon: string
  /** An uploaded square image, shown instead of the emoji. */
  image_url: string | null
  item_count: number
  created_at: string
  updated_at: string
}

export const collectionsKey = ['collections']

export function useCollections() {
  return useQuery({
    queryKey: collectionsKey,
    // A personal app has few collections: one large page is enough for now.
    queryFn: () => api<Page<Collection>>('/collections/?limit=500').then((page) => page.results),
  })
}

export function useCreateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; kind?: CollectionKind }) =>
      api<Collection>('/collections/', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionsKey }),
  })
}

export type CollectionChanges = Partial<Pick<Collection, 'name' | 'kind' | 'color' | 'icon'>>

export function useUpdateCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...changes }: CollectionChanges & { id: string }) =>
      api<Collection>(`/collections/${id}/`, { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionsKey }),
  })
}

/** Sets (a square image, already small) or removes a collection's image. */
export function setCollectionImage(id: string, image: Blob | null) {
  if (!image) return api<Collection>(`/collections/${id}/image/`, { method: 'DELETE' })
  const form = new FormData()
  form.append('file', image, 'image.webp')
  return api<Collection>(`/collections/${id}/image/`, { method: 'POST', body: form })
}

/** What happens to the items that are only in a deleted collection. */
export type OrphanAction = 'inbox' | 'archive' | 'delete'

export function useDeleteCollection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: OrphanAction }) =>
      api<void>(`/collections/${id}/?items=${items}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collectionsKey })
      queryClient.invalidateQueries({ queryKey: itemsKey })
    },
  })
}

function refreshLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: itemsKey,
    predicate: (query) => query.queryKey[1] !== 'detail',
  })
}

export function makeAlbum(ids: string[], title = '') {
  return api<Item>('/items/albums/', {
    method: 'POST',
    body: JSON.stringify({ items: ids, title }),
  })
}

/** Keeps several images as one item, in this order. */
export function useMakeAlbum() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, title }: { ids: string[]; title?: string }) => makeAlbum(ids, title),
    onSuccess: () => refreshLists(queryClient),
  })
}

/** What an album holds, in order: reorders, and images left out go back on their own. */
export function useSetAlbumItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ album, ids }: { album: string; ids: string[] }) =>
      api<Item>(`/items/${album}/album-items/`, {
        method: 'PUT',
        body: JSON.stringify({ items: ids }),
      }),
    onSuccess: (album) => {
      queryClient.setQueryData(itemKey(album.id), album)
      refreshLists(queryClient)
    },
  })
}

export function ungroupAlbum(album: string) {
  return api<Item[]>(`/items/${album}/ungroup/`, { method: 'POST' })
}

/** Takes an album away; its images stay, on their own. */
export function useUngroupAlbum() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ungroupAlbum,
    onSuccess: () => refreshLists(queryClient),
  })
}
