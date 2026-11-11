import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sessionKey, type Session } from '../auth/session'
import { AppearancePanel } from './AppearancePanel'
import { applyTheme } from './theme'

function renderPanel(ok = true) {
  const fetch = vi.fn(async () => new Response(null, { status: ok ? 204 : 500 }))
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  queryClient.setQueryData<Session>(sessionKey, {
    authenticated: true,
    user: { id: 1, username: 'alex', email: '', is_staff: false },
    theme: 'system',
  })
  render(
    <QueryClientProvider client={queryClient}>
      <AppearancePanel />
    </QueryClientProvider>,
  )
  return { fetch, queryClient }
}

afterEach(() => {
  vi.unstubAllGlobals()
  applyTheme('system')
})

describe('AppearancePanel', () => {
  it('follows the system until a theme is picked', () => {
    renderPanel()

    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })

  it('shows the picked theme right away and saves it for every device', async () => {
    const { fetch, queryClient } = renderPanel()

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem('brainbro:theme')).toBe('dark')
    expect(queryClient.getQueryData<Session>(sessionKey)?.theme).toBe('dark')
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/theme/',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ theme: 'dark' }) }),
      ),
    )
  })

  it('going back to the system forgets the theme on this device', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))

    fireEvent.click(screen.getByRole('radio', { name: 'System' }))

    expect(document.documentElement).not.toHaveAttribute('data-theme')
    expect(localStorage.getItem('brainbro:theme')).toBeNull()
  })

  it('goes back to the previous theme when saving fails', async () => {
    renderPanel(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the theme")
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).not.toHaveAttribute('data-theme')
  })
})
