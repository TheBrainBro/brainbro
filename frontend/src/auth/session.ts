import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type User = {
  id: number
  username: string
  email: string
  is_staff: boolean
}

export type Session = {
  authenticated: boolean
  user: User | null
}

const sessionKey = ['session']

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    // Also sets the csrftoken cookie needed by every unsafe request.
    queryFn: () => api<Session>('/auth/session/'),
    staleTime: Infinity,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api<Session>('/auth/login/', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }),
    onSuccess: (session) => queryClient.setQueryData(sessionKey, session),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout/', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear()
      // Refetch to get a fresh CSRF cookie for the next login.
      queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
}
