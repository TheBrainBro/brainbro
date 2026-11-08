import { useQuery } from '@tanstack/react-query'

import type { NoteImages, NoteLinks } from '../items/api'
import { api } from '../lib/api'

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

/**
 * A published note in a list: at `/p` every one on the server, on a blog its
 * own. `url` is where it lives: `/@<handle>/<slug>`, `/<slug>` on the blog
 * being read, or another blog's full URL.
 */
export type PublicNoteSummary = { slug: string; title: string; published_at: string; url: string }

/** A published note, as anyone reads it. */
export type PublicNote = Omit<PublicNoteSummary, 'url'> & {
  handle: string
  body: string
  edited_at: string | null
  /** Its author's display name; empty when they have none. */
  author: string
  images: NoteImages
  links: NoteLinks
  /** The published notes its `[[links]]` lead to, by the titles they find. */
  notes: { url: string; title: string }[]
}

/** The blog on whose domain the app is open. */
export type PublicSite = {
  hostname: string
  title: string
  description: string
  author: string
  handle: string
}

/** The blog's domain, when the server serves the app as one (`brainbro-site`). */
export function siteHostname() {
  return document.querySelector<HTMLMetaElement>('meta[name="brainbro-site"]')?.content ?? null
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

export function usePublicNotes() {
  return useQuery({
    queryKey: ['public', 'notes'],
    queryFn: () => api<Page<PublicNoteSummary>>('/public/notes/?limit=200'),
  })
}

export function usePublicSite() {
  return useQuery({
    queryKey: ['public', 'site'],
    queryFn: () => api<PublicSite>('/public/site/'),
  })
}

/** Where a note published at `/p/<slug>`, its address before handles, is now. */
export function useLegacyNote(slug: string) {
  return useQuery({
    queryKey: ['public', 'legacy', slug],
    queryFn: () => api<{ url: string }>(`/public/legacy/${encodeURIComponent(slug)}/`),
  })
}
