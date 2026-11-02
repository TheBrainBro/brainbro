import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionKey, type Session } from '../auth/session'
import { api } from '../lib/api'

export type Invitation = {
  id: string
  /** Who it's for, so the admin can tell links apart. */
  note: string
  created_at: string
  expires_at: string
  status: 'pending' | 'accepted' | 'expired'
  used_at: string | null
  /** Who joined with it; null if not yet, or if that account was deleted. */
  used_by: string | null
}

/** An invitation just made: the only time its link comes back. */
export type NewInvitation = Invitation & { url: string }

const invitationsKey = ['invitations'] as const

/** Every link, pending, accepted or expired. Admins only. */
export function useInvitations() {
  return useQuery({ queryKey: invitationsKey, queryFn: () => api<Invitation[]>('/auth/invitations/') })
}

export function useCreateInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (note: string) =>
      api<NewInvitation>('/auth/invitations/', { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey }),
  })
}

/** Revokes a pending link or removes an expired one. */
export function useRevokeInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/invitations/${id}/`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invitationsKey }),
  })
}

/** Whether an invitation link can still be used: an error if not. */
export function useInvitationCheck(token: string) {
  return useQuery({
    queryKey: ['join', token],
    queryFn: () => api<{ valid: true }>(`/auth/join/${token}/`),
    retry: false,
  })
}

/** Makes the account with the link; the new user ends up signed in. */
export function useJoin(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (account: { username: string; password: string }) =>
      api<Session>(`/auth/join/${token}/`, { method: 'POST', body: JSON.stringify(account) }),
    onSuccess: (session) => queryClient.setQueryData(sessionKey, session),
  })
}
