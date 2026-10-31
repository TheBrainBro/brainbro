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
  limits?: { upload_max_size: number }
  /** Whether this user already closed the welcome tour, on any device. */
  welcome_seen?: boolean
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
      // Drop the user's data but keep the session query itself, signed out:
      // clear() would remove it under its observers, which then never update
      // (the app stayed on screen). The refetch gets a fresh CSRF cookie for
      // the next login.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] })
      queryClient.setQueryData<Session>(sessionKey, { authenticated: false, user: null })
      queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
}

/** Remembers on the server that the welcome tour was seen, for every device. */
export function useMarkWelcomeSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/welcome/', { method: 'POST' }),
    onMutate: () =>
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, welcome_seen: true } : session,
      ),
  })
}
