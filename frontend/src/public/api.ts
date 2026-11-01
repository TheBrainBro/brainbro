import { useQuery } from '@tanstack/react-query'

import type { NoteImages, NoteLinks } from '../items/api'
import { api } from '../lib/api'

type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] }

/** A published note in the index at `/p`. */
export type PublicNoteSummary = { slug: string; title: string; published_at: string }

/** A published note, as anyone reads it at `/p/<slug>`. */
export type PublicNote = PublicNoteSummary & {
  body: string
  edited_at: string | null
  images: NoteImages
  links: NoteLinks
  /** The published notes its `[[links]]` lead to, by the titles they find. */
  notes: { slug: string; title: string }[]
}

export function usePublicNote(slug: string) {
  return useQuery({
    queryKey: ['public', 'notes', slug],
    queryFn: () => api<PublicNote>(`/public/notes/${encodeURIComponent(slug)}/`),
  })
}

export function usePublicNotes() {
  return useQuery({
    queryKey: ['public', 'notes'],
    queryFn: () => api<Page<PublicNoteSummary>>('/public/notes/?limit=200'),
  })
}
