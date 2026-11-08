import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { boardKey, type Board, type Layout } from '../boards/api'
import { t } from '../i18n/i18n'
import { itemKey, type Item, type ItemSource } from '../items/api'
import { api } from '../lib/api'

/**
 * A note's or a board's content as it was saved, and who saved it (backend
 * apps.history). Saves by the same author in a row are one revision, from
 * `created_at` to `updated_at`. The newest is what it holds now.
 */
export type Revision = {
  id: string
  item: string | null
  board: string | null
  title: string
  /** The app that saved it; empty for the user. */
  by: string
  via: ItemSource
  /** Which assistant's logo goes with it; empty for the generic icon. */
  logo: string
  /** The revision this one brought back, and when that one started. */
  restored_from: string | null
  restored_from_at: string | null
  created_at: string
  updated_at: string
}

export type RevisionDetail = Revision & {
  /** Notes only. */
  body: string
  /** Boards only: the layout, and the items on it that still exist. */
  layout: Layout | null
  items: Item[] | null
}

/** Whose history: a note's or a board's. */
export type HistoryTarget = { item: string } | { board: string }

type Page<T> = { count: number; next: string | null; results: T[] }

const PAGE_SIZE = 50

/**
 * Under the note's or the board's own key: whatever refreshes it (a change
 * made elsewhere, a save here) refreshes its history too.
 */
export function historyKey(target: HistoryTarget) {
  const owner = 'item' in target ? itemKey(target.item) : boardKey(target.board)
  return [...owner, 'revisions']
}

function query(target: HistoryTarget) {
  return 'item' in target ? `item=${target.item}` : `board=${target.board}`
}

/**
 * The history, newest first. `version` is the note's or board's own (its
 * fingerprint, its revision): saved here, the list follows.
 */
export function useRevisions(target: HistoryTarget, version: string | number) {
  return useInfiniteQuery({
    queryKey: [...historyKey(target), 'list', version],
    queryFn: ({ pageParam }) =>
      api<Page<Revision>>(
        `/revisions/?${query(target)}&limit=${PAGE_SIZE}&offset=${pageParam}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.next ? pages.length * PAGE_SIZE : undefined),
    placeholderData: keepPreviousData,
  })
}

/** A revision from the list, with its content. */
export function useRevision(target: HistoryTarget, revision: Revision | undefined) {
  return useQuery({
    // The newest revision takes saves for a few minutes: `updated_at` says which.
    queryKey: [...historyKey(target), 'detail', revision?.id, revision?.updated_at],
    queryFn: () => api<RevisionDetail>(`/revisions/${revision?.id}/`),
    enabled: Boolean(revision),
    staleTime: Infinity,
  })
}

/** Saves a note's revision again, as a new one; resolves to the note. */
export function restoreNote(id: string) {
  return api<Item>(`/revisions/${id}/restore/`, { method: 'POST' })
}

/** Saves a board's revision again, as a new one; resolves to the board. */
export function restoreBoard(id: string) {
  return api<Board>(`/revisions/${id}/restore/`, { method: 'POST' })
}

/** Who saved it, in a few words: "You", "Claude", "You, from Telegram", "Imported". */
export function revisionAuthor(revision: Pick<Revision, 'by' | 'via'>) {
  if (revision.via === 'import') return t('history.imported')
  if (revision.by) return revision.by
  return revision.via === 'telegram' ? t('history.youTelegram') : t('history.you')
}
