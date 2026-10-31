import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type ApiToken = {
  id: string
  name: string
  /** The start of the token, to tell them apart. */
  prefix: string
  created_at: string
  last_used_at: string | null
}

/** A token just made: the only time `token` itself comes back. */
export type NewApiToken = ApiToken & { token: string }

const tokensKey = ['api-tokens'] as const

export function useApiTokens() {
  return useQuery({ queryKey: tokensKey, queryFn: () => api<ApiToken[]>('/auth/tokens/') })
}

export function useCreateApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api<NewApiToken>('/auth/tokens/', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  })
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/tokens/${id}/`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tokensKey }),
  })
}
