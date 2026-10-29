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
  /** Fingerprint of title and body, sent back as If-Match when saving. */
  version: string
  created_at: string
  updated_at: string
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
    // Previews and thumbnails are made in the background: poll until none is pending.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.results.some((item) => item.preview_status === 'pending'),
      )
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

/** One item, refetched when the window regains focus so other tabs' edits show up. */
export function useItem(id: string | undefined) {
  return useQuery({
    queryKey: itemKey(id ?? ''),
    queryFn: () => api<Item>(`/items/${id}/`),
    enabled: Boolean(id),
    refetchOnWindowFocus: true,
  })
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
  color: string
  icon: string
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
