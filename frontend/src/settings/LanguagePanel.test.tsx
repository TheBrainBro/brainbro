import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sessionKey, type Session } from '../auth/session'
import { applyLanguage } from '../i18n/i18n'
import { LanguagePanel } from './LanguagePanel'

function renderPanel(ok = true) {
  const fetch = vi.fn(async () => new Response(null, { status: ok ? 204 : 500 }))
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  queryClient.setQueryData<Session>(sessionKey, {
    authenticated: true,
    user: { id: 1, username: 'carlos', email: '', is_staff: false },
    language: 'system',
  })
  render(
    <QueryClientProvider client={queryClient}>
      <LanguagePanel />
    </QueryClientProvider>,
  )
  return { fetch, queryClient }
}

afterEach(() => {
  vi.unstubAllGlobals()
  applyLanguage('system')
})

describe('LanguagePanel', () => {
  it("follows the browser's language until one is picked", () => {
    renderPanel()

    expect(screen.getByRole('radio', { name: 'Browser' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.lang).toBe('en')
  })

  it('shows the picked language right away and saves it for every device', async () => {
    const { fetch, queryClient } = renderPanel()

    fireEvent.click(screen.getByRole('radio', { name: 'Español' }))

    expect(screen.getByRole('radiogroup', { name: 'Idioma' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Navegador' })).toHaveAttribute('aria-checked', 'false')
    expect(document.documentElement.lang).toBe('es')
    expect(queryClient.getQueryData<Session>(sessionKey)?.language).toBe('es')
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/language/',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ language: 'es' }) }),
      ),
    )
  })

  it('goes back to the previous language when saving fails', async () => {
    renderPanel(false)

    fireEvent.click(screen.getByRole('radio', { name: 'Español' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the language")
    expect(screen.getByRole('radio', { name: 'Browser' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.lang).toBe('en')
  })
})
