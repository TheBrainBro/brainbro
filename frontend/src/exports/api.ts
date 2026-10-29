import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type ExportStatus = 'pending' | 'ready' | 'failed'

export type Export = {
  id: string
  status: ExportStatus
  size: number | null
  filename: string
  download_url: string | null
  created_at: string
  finished_at: string | null
}

const latestKey = ['exports', 'latest'] as const
const POLL_MS = 2000

/** The latest export (only one is kept), polled while it's being built. */
export function useLatestExport() {
  return useQuery({
    queryKey: latestKey,
    queryFn: async () => (await api<{ results: Export[] }>('/exports/')).results[0] ?? null,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
  })
}

/** Starts a new export, or returns the one being built. */
export function useStartExport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<Export>('/exports/', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(latestKey, data),
  })
}
