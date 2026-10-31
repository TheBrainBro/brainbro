import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiToken } from './api'
import { TokensPanel } from './TokensPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const existing: ApiToken = {
  id: 't1',
  name: 'Script',
  prefix: 'brain_ab12',
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
}

function renderPanel(tokens: ApiToken[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { name } = JSON.parse(String(init.body))
      return jsonResponse(
        { ...existing, id: 't2', name, prefix: 'brain_cd34', token: 'brain_cd34secret' },
        201,
      )
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return jsonResponse(url === '/api/auth/tokens/' ? tokens : [])
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TokensPanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('TokensPanel', () => {
  it('creates a token and shows it once, with the Claude Code command', async () => {
    renderPanel([])

    fireEvent.change(screen.getByRole('textbox', { name: 'Token name' }), {
      target: { value: 'Claude Code' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copy “Claude Code” now: it won\'t be shown again.',
    )
    expect(screen.getByRole('textbox', { name: 'Token' })).toHaveValue('brain_cd34secret')
    expect(screen.getByRole('textbox', { name: 'Claude Code command' })).toHaveValue(
      `claude mcp add --transport http brain ${window.location.origin}/api/mcp/ --header "Authorization: Bearer brain_cd34secret"`,
    )
  })

  it('needs a name', () => {
    renderPanel([])
    expect(screen.getByRole('button', { name: 'Create token' })).toBeDisabled()
  })

  it('lists tokens and revokes one after confirming', async () => {
    const fetchMock = renderPanel([existing])

    expect(await screen.findByText('Script')).toBeInTheDocument()
    expect(screen.getByText(/never used/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Script' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/tokens/t1/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
