import { useQuery } from '@tanstack/react-query'

import type { NoteImages, NoteLinks } from '../items/api'
import { api } from '../lib/api'

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

/**
 * A published note in a list: every one on the server, at `/p`. `url` is where
 * it lives: `/@<handle>/<slug>`, or its blog's full URL.
 */
export type PublicNoteSummary = {
  slug: string
  title: string
  published_at: string
  url: string
  /** The start of its text, or its page description. */
  excerpt: string
  /** Its cover: the image its shared link shows, if any. */
  image_url: string | null
}

/** A published note, as anyone reads it. */
export type PublicNote = Omit<PublicNoteSummary, 'url' | 'excerpt' | 'image_url'> & {
  handle: string
  body: string
  edited_at: string | null
  /** Its author's display name; empty when they have none. */
  author: string
  avatar_url: string | null
  images: NoteImages
  links: NoteLinks
  /** The published notes its `[[links]]` lead to, by the titles they find. */
  notes: { url: string; title: string }[]
}

export function usePublicNote(handle: string, slug: string) {
  return useQuery({
    queryKey: ['public', 'notes', handle, slug],
    queryFn: () =>
      api<PublicNote>(
        `/public/notes/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}/`,
      ),
    enabled: Boolean(handle),
  })
}

/** Published notes: all on the server, or one author's. */
export function usePublicNotes({ author }: { author?: string } = {}) {
  const params = new URLSearchParams({ limit: '200' })
  if (author) params.set('author', author)
  return useQuery({
    queryKey: ['public', 'notes', { author }],
    queryFn: () => api<Page<PublicNoteSummary>>(`/public/notes/?${params}`),
  })
}

/** An author's page, `/@<handle>`: their display name, empty without one. */
export type PublicAuthor = { handle: string; author: string; avatar_url: string | null }

export function usePublicAuthor(handle: string) {
  return useQuery({
    queryKey: ['public', 'authors', handle],
    queryFn: () => api<PublicAuthor>(`/public/authors/${encodeURIComponent(handle)}/`),
  })
}

/** Where a note published at `/p/<slug>`, its address before handles, is now. */
export function useLegacyNote(slug: string) {
  return useQuery({
    queryKey: ['public', 'legacy', slug],
    queryFn: () => api<{ url: string }>(`/public/legacy/${encodeURIComponent(slug)}/`),
  })
}
