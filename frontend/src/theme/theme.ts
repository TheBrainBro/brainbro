import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'

import { sessionKey, type Session } from '../auth/session'
import { api } from '../lib/api'
import { useMediaQuery } from '../lib/dom'

/** Light, dark, or whatever the device is set to. */
export type Theme = 'light' | 'dark' | 'system'

export const THEMES: Theme[] = ['light', 'dark', 'system']

// Also read by the script in index.html, so the first paint is already right.
const KEY = 'brain:theme'

// The browser bar (theme-color) matches the top bar: white, or zinc-950.
const BAR_COLORS = { light: '#ffffff', dark: '#09090b' }

const listeners = new Set<() => void>()

/** Paints the browser bar: the picked theme, or each scheme's color while following the system. */
function paintBar(theme: Theme) {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light'
    meta.content = BAR_COLORS[theme === 'system' ? scheme : theme]
  })
}

/** The theme shown now: `data-theme` on <html>, absent while following the system. */
export function currentTheme(): Theme {
  const value = document.documentElement.dataset.theme
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** Shows `theme` and remembers it on this device until the session says otherwise. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  paintBar(theme)
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Blocked storage: the next load follows the system until the session arrives.
  }
  listeners.forEach((listener) => listener())
}

/** The theme chosen, kept up to date. */
export function useTheme() {
  return useSyncExternalStore((onChange) => {
    listeners.add(onChange)
    return () => listeners.delete(onChange)
  }, currentTheme)
}

/** Whether the screen is dark now, for what CSS can't reach (canvas drawing). */
export function useDark() {
  const theme = useTheme()
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** Shows the theme the user chose, on any device, once the session knows it. */
export function useSessionTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])
}

/** Picks a theme: it shows right away and is saved for every device. */
export function useSetTheme() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (theme: Theme) =>
      api<void>('/auth/theme/', { method: 'PUT', body: JSON.stringify({ theme }) }),
    onMutate: (theme) => {
      const previous = queryClient.getQueryData<Session>(sessionKey)?.theme
      applyTheme(theme)
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, theme } : session,
      )
      return { previous }
    },
    onError: (_error, _theme, context) => {
      if (!context?.previous) return
      applyTheme(context.previous)
      queryClient.setQueryData<Session>(sessionKey, (session) =>
        session ? { ...session, theme: context.previous } : session,
      )
    },
  })
}
