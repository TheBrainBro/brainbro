import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { isProcessing, itemKey, itemsKey, type Item } from '../items/api'
import { api } from '../lib/api'

/** The stored layout, schema version 1 (see docs/boards.md). */
export type Layout = {
  schema_version: 1
  viewport: { x: number; y: number; zoom: number }
  nodes: LayoutNode[]
  groups: LayoutGroup[]
  edges: LayoutEdge[]
}

type LayoutBox = {
  id: string
  x: number
  y: number
  /** Null: the node's natural size. */
  w: number | null
  h: number | null
  parent: string | null
}

export type LayoutItemNode = LayoutBox & { type: 'item'; item: string }

/** Text on a colored card that lives only on the board. */
export type LayoutStickyNode = LayoutBox & { type: 'sticky'; text: string; color: string }

/** A pen line: points relative to its corner, in a box of `w` by `h`. */
export type LayoutStrokeNode = LayoutBox & {
  type: 'stroke'
  points: [number, number][]
  color: string
  width: number
}

export type LayoutNode = LayoutItemNode | LayoutStickyNode | LayoutStrokeNode

export type LayoutGroup = {
  id: string
  title: string
  color: string
  x: number
  y: number
  w: number
  h: number
  parent: string | null
}

export type EdgeArrow = 'end' | 'none' | 'both'
export type EdgeStroke = 'solid' | 'dashed'

export type LayoutEdge = {
  id: string
  source: string
  target: string
  label: string
  /** Missing in layouts saved before edges had looks: `end`, `solid` and ''. */
  arrow?: EdgeArrow
  stroke?: EdgeStroke
  /** Hex, or '' for the default. */
  color?: string
}

export type BoardSummary = {
  id: string
  title: string
  item_count: number
  revision: number
  created_at: string
  updated_at: string
}

export type Board = BoardSummary & { layout: Layout; items: Item[] }

export type SavedLayout = { revision: number; layout: Layout; updated_at: string }

type Page<T> = { count: number; results: T[] }

const PREVIEW_POLL_MS = 2000

export const boardsKey = ['boards']
export const boardKey = (id: string) => [...boardsKey, 'detail', id]

export function useBoards() {
  return useQuery({
    queryKey: boardsKey,
    // A personal app has few boards: one large page is enough for now.
    queryFn: () => api<Page<BoardSummary>>('/boards/?limit=500').then((page) => page.results),
  })
}

/**
 * A board with its items. Each item also goes into its own cache entry, which
 * is what nodes read: edits elsewhere (ticking a task, the note editor) show
 * up on the canvas without touching the layout.
 */
export function useBoard(id: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: boardKey(id),
    queryFn: async () => {
      const board = await api<Board>(`/boards/${id}/`)
      seedItems(queryClient, board.items)
      return board
    },
    // Previews, thumbnails and note images are made in the background:
    // poll until none is pending.
    refetchInterval: (query) =>
      query.state.data?.items.some(isProcessing) ? PREVIEW_POLL_MS : false,
  })
}

export function seedItems(queryClient: QueryClient, items: Item[]) {
  for (const item of items) queryClient.setQueryData(itemKey(item.id), item)
}

/**
 * One item of an open board, from the cache `useBoard` fills. Items placed
 * since the board loaded (just captured onto it) poll on their own until
 * their preview, thumbnail or note images are made.
 */
export function useBoardItem(id: string) {
  return useQuery({
    queryKey: itemKey(id),
    queryFn: () => api<Item>(`/items/${id}/`),
    staleTime: Infinity,
    refetchInterval: (query) =>
      query.state.data && isProcessing(query.state.data) ? PREVIEW_POLL_MS : false,
  }).data
}

export function useCreateBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      api<BoardSummary>('/boards/', { method: 'POST', body: JSON.stringify({ title }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardsKey }),
  })
}

export function useRenameBoard(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) =>
      api<BoardSummary>(`/boards/${id}/`, { method: 'PATCH', body: JSON.stringify({ title }) }),
    onSuccess: (board) => {
      queryClient.setQueryData<Board>(boardKey(id), (cached) => cached && { ...cached, ...board })
      queryClient.invalidateQueries({ queryKey: boardsKey, exact: true })
    },
  })
}

export function useDeleteBoard() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/boards/${id}/`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardsKey, exact: true })
      // Its items with nowhere else to be went back to the inbox.
      queryClient.invalidateQueries({
        queryKey: itemsKey,
        predicate: (query) => query.queryKey[1] !== 'detail',
      })
    },
  })
}

/** Replaces the layout if the server still has `revision`; rejects with a 412 ApiError if not. */
export function saveLayout(
  id: string,
  layout: Layout,
  revision: number,
  { keepalive = false } = {},
) {
  return api<SavedLayout>(`/boards/${id}/layout/`, {
    method: 'PUT',
    body: JSON.stringify(layout),
    headers: { 'If-Match': `"${revision}"` },
    keepalive,
  })
}
