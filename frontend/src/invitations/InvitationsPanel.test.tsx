import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Invitation } from './api'
import { InvitationsPanel } from './InvitationsPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const pending: Invitation = {
  id: 'i1',
  note: 'Ana',
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2026-01-08T00:00:00Z',
}

function renderPanel(invitations: Invitation[]) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { note } = JSON.parse(String(init.body))
      return jsonResponse(
        { ...pending, id: 'i2', note, url: 'https://brain.example.com/join/secret' },
        201,
      )
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return jsonResponse(invitations)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <InvitationsPanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('InvitationsPanel', () => {
  it('creates a link and shows it once', async () => {
    const fetchMock = renderPanel([])

    fireEvent.change(screen.getByRole('textbox', { name: "Who it's for" }), {
      target: { value: 'Bea' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))

    expect(await screen.findByRole('status')).toHaveTextContent("it won't be shown again")
    expect(screen.getByRole('textbox', { name: 'Invitation link' })).toHaveValue(
      'https://brain.example.com/join/secret',
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/invitations/',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ note: 'Bea' }) }),
    )
  })

  it('revokes a pending link after confirming', async () => {
    const fetchMock = renderPanel([pending])

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Ana' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/invitations/i1/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
