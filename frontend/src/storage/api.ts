import { useQuery } from '@tanstack/react-query'

import { api } from '../lib/api'

/** Bytes the user's files take on disk, and their quota (null: no limit). */
export type Storage = { used: number; quota: number | null }

export const storageKey = ['storage'] as const

export function useStorage() {
  return useQuery({ queryKey: storageKey, queryFn: () => api<Storage>('/auth/storage/') })
}
