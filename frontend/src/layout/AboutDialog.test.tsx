import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AboutDialog } from './AboutDialog'

function renderWith(session: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ authenticated: true, user: null, ...session }), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AboutDialog onClose={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('AboutDialog', () => {
  it('links the source code the server says it runs', async () => {
    renderWith({ source_code_url: 'https://git.example.com/me/brainbro' })
    const link = await screen.findByRole('link', { name: 'Source code' })
    await vi.waitFor(() =>
      expect(link.getAttribute('href')).toBe('https://git.example.com/me/brainbro'),
    )
  })

  it('falls back to the BrainBro repository', async () => {
    renderWith({})
    const link = await screen.findByRole('link', { name: 'Source code' })
    expect(link.getAttribute('href')).toBe('https://github.com/TheBrainBro/brainbro')
  })
})
