import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type ItemKind = 'note' | 'link' | 'image' | 'file'
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
  created_at: string
  updated_at: string
}

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

const PAGE_SIZE = 50
const PREVIEW_POLL_MS = 2000

export const itemsKey = ['items']

export function useItems(filters: { status?: ItemStatus; collection?: string }) {
  return useInfiniteQuery({
    queryKey: [...itemsKey, filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam) })
      if (filters.status) params.set('status', filters.status)
      if (filters.collection) params.set('collection', filters.collection)
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

export function useRefreshPreview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<Item>(`/items/${id}/refresh-preview/`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  })
}

export type TriageAction = 'organize' | 'archive' | 'inbox' | 'delete'

export function useTriage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { ids: string[]; action: TriageAction; collections?: string[] }) =>
      api<unknown>('/items/triage/', { method: 'POST', body: JSON.stringify(payload) }),
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
