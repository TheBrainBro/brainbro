import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, upload } from '../lib/api'

export type ImportStatus = 'pending' | 'ready' | 'failed'

/** What the zip held: an Obsidian vault or a BrainBro export. */
export type ImportSource = 'obsidian' | 'brainbro'

export type ImportCounts = {
  notes: number
  images: number
  files: number
  links: number
  albums: number
  boards: number
  collections: number
  /** BrainBro exports: things that were already here, left as they are. */
  existing: number
  skipped: number
}

export type VaultImport = {
  id: string
  status: ImportStatus
  source: ImportSource
  filename: string
  counts: Partial<ImportCounts>
  error: string
  created_at: string
  finished_at: string | null
}

const latestKey = ['imports', 'latest'] as const
const POLL_MS = 2000

/** The latest import, polled while it runs. Everything is refetched when it's done. */
export function useLatestImport() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: latestKey,
    queryFn: async () => {
      const latest = (await api<{ results: VaultImport[] }>('/imports/')).results[0] ?? null
      const before = queryClient.getQueryData<VaultImport | null>(latestKey)
      if (before?.status === 'pending' && latest?.status === 'ready') {
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] !== 'imports',
        })
      }
      return latest
    },
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? POLL_MS : false),
  })
}

/** Uploads a zip to import, with its progress (0 to 1) while it goes up. */
export function useStartImport() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState(0)
  const mutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      setProgress(0)
      return upload<VaultImport>('/imports/', form, {
        onProgress: setProgress,
      })
    },
    onSuccess: (data) => queryClient.setQueryData(latestKey, data),
  })
  return { ...mutation, progress }
}
