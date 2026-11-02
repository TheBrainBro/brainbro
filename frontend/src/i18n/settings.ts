import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { sessionKey, type Session } from '../auth/session'
import { api } from '../lib/api'
import { applyLanguage, type LanguageChoice } from './i18n'

/** Shows the language the user chose, on any device, once the session knows it. */
export function useSessionLanguage(next: LanguageChoice | undefined) {
  useEffect(() => {
    if (next) applyLanguage(next)
  }, [next])
}

/** Picks a language: it shows right away and is saved for every device. */
export function useSetLanguage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (next: LanguageChoice) =>
      api<void>('/auth/language/', { method: 'PUT', body: JSON.stringify({ language: next }) }),
    onMutate: (next) => {
      const previous = queryClient.getQueryData<Session>(sessionKey)?.language
      applyLanguage(next)
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, language: next } : session,
      )
      return { previous }
    },
    onError: (_error, _next, context) => {
      if (!context?.previous) return
      applyLanguage(context.previous)
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, language: context.previous } : session,
      )
    },
  })
}
