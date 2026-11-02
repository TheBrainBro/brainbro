import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type ApiToken = {
  id: string
  name: string
  /** The start of the token, to tell them apart. */
  prefix: string
  /** An app connected by signing in (OAuth), not a token made here. */
  connected_app: boolean
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

/** Who asks to connect through "Sign in to BrainBro", for the authorize page. */
export type AuthorizationAsk = { client_name: string; redirect_host: string }

/** The app's query, checked: an unknown app or return address is an error. */
export function useAuthorizationAsk(query: string) {
  return useQuery({
    queryKey: ['oauth-authorize', query],
    queryFn: () => api<AuthorizationAsk>(`/auth/oauth/authorize/?${query}`),
    retry: false,
  })
}

/** Allow or cancel: the answer is where to send the browser back to the app. */
export function useAnswerAuthorization(query: string) {
  return useMutation({
    mutationFn: (allow: boolean) =>
      api<{ redirect_to: string }>('/auth/oauth/authorize/', {
        method: 'POST',
        body: JSON.stringify({ ...Object.fromEntries(new URLSearchParams(query)), allow }),
      }),
    onSuccess: ({ redirect_to }) => window.location.assign(redirect_to),
  })
}
