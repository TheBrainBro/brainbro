import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'
import type { LanguageChoice } from '../i18n/i18n'
import type { Theme } from '../theme/theme'

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
  /** Where the guided tour stands, the same on every device. */
  tutorial?: TutorialProgress
  /** Whether this account has sample content that can be removed. */
  has_sample_content?: boolean
  /** The theme chosen, the same on every device. */
  theme?: Theme
  /** The language chosen, the same on every device; `system` follows the browser. */
  language?: LanguageChoice
  profile?: Profile
}

/** The parts of the guided tour: its first loop, then the tracks from its hub. */
export type TutorialPart = 'loop' | 'boards' | 'graph' | 'assistant' | 'examples'

export type TutorialProgress = {
  started: boolean
  done: TutorialPart[]
  /** Put away for good: finished, or dismissed from its pill. */
  closed: boolean
}

export type TutorialUpdate = { action: 'start' } | { action: 'close' } | { action: 'done'; part: TutorialPart }

/** How the user shows: in the app, and as the author of their public notes. */
export type Profile = {
  /** Signs their public notes; empty, they show no author. Never the username. */
  display_name: string
  /** Their public address, `/@<handle>/`; empty until they first publish. */
  handle?: string
  avatar_url: string | null
}

export const sessionKey = ['session']

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

/** Makes the BrainBro starter content once, or returns it if it already exists. */
export function useCreateSampleContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (url: string) =>
      api<void>('/auth/sample-content/', {
        method: 'POST',
        body: JSON.stringify({ mcp_url: url }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries()
    },
  })
}

/** Removes only the content marked as sample, after the caller confirms. */
export function useRemoveSampleContent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/sample-content/', { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, has_sample_content: false } : session,
      )
      queryClient.invalidateQueries()
    },
  })
}

/** Puts the saved profile into the session, where the app reads it. */
function useProfileMutation<T>(save: (value: T) => Promise<Profile>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: save,
    onSuccess: (profile) =>
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, profile } : session,
      ),
  })
}

export function useSaveHandle() {
  return useProfileMutation((handle: string) =>
    api<Profile>('/auth/profile/', { method: 'PATCH', body: JSON.stringify({ handle }) }),
  )
}

export function useSaveDisplayName() {
  return useProfileMutation((display_name: string) =>
    api<Profile>('/auth/profile/', { method: 'PATCH', body: JSON.stringify({ display_name }) }),
  )
}

/** A new profile photo (already cropped square), or null to remove it. */
export function useSetAvatar() {
  return useProfileMutation((image: Blob | null) => {
    if (!image) return api<Profile>('/auth/profile/avatar/', { method: 'DELETE' })
    const form = new FormData()
    form.append('file', image, 'avatar.webp')
    return api<Profile>('/auth/profile/avatar/', { method: 'POST', body: form })
  })
}

const NOT_STARTED: TutorialProgress = { started: false, done: [], closed: false }

/** Saves where the guided tour stands, for every device; the session shows it at once. */
export function useTutorialProgress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (update: TutorialUpdate) =>
      api<void>('/auth/tutorial/', { method: 'POST', body: JSON.stringify(update) }),
    onMutate: (update) =>
      queryClient.setQueryData<Session>(sessionKey, (session) => {
        if (!session) return session
        const current = session.tutorial ?? NOT_STARTED
        const tutorial =
          update.action === 'start'
            ? { started: true, done: [], closed: false }
            : update.action === 'close'
              ? { ...current, closed: true }
              : {
                  ...current,
                  done: current.done.includes(update.part) ? current.done : [...current.done, update.part],
                }
        return { ...session, tutorial }
      }),
  })
}
