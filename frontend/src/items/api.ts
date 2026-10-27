import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type ItemKind = 'note' | 'link' | 'image' | 'file'
export type ItemStatus = 'inbox' | 'organized' | 'archived'
export type PreviewStatus = '' | 'pending' | 'ready' | 'failed'

export type LinkMetadata = {
  title?: string
  description?: string
  site_name?: string
  author?: string
  favicon_url?: string
  final_url?: string
  image_url?: string
  preview_error?: string
}

export type Item = {
  id: string
  kind: ItemKind
  status: ItemStatus
  title: string
  body: string
  url: string
  metadata: LinkMetadata
  preview_status: PreviewStatus
  preview_image_url: string | null
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
    // Previews are fetched in the background: poll until none is pending.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.results.some((item) => item.preview_status === 'pending'),
      )
        ? PREVIEW_POLL_MS
        : false,
  })
}

export function useCapture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (text: string) =>
      api<Item>('/items/capture/', { method: 'POST', body: JSON.stringify({ text }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  })
}

export function useRefreshPreview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<Item>(`/items/${id}/refresh-preview/`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: itemsKey }),
  })
}
