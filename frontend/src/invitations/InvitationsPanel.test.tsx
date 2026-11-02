import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  status: 'pending',
  used_at: null,
  used_by: null,
}

const accepted: Invitation = {
  ...pending,
  id: 'i3',
  note: 'Bea',
  status: 'accepted',
  used_at: '2026-01-02T00:00:00Z',
  used_by: 'bea',
}

const expired: Invitation = { ...pending, id: 'i4', note: 'Cris', status: 'expired' }

function renderPanel(invitations: Invitation[]) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { note } = JSON.parse(String(init.body))
      return jsonResponse(
        { ...pending, id: 'i2', note, url: 'https://brainbro.example.com/join/secret' },
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
      'https://brainbro.example.com/join/secret',
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

  it('shows who accepted a link, with nothing to revoke', async () => {
    renderPanel([accepted])

    expect(await screen.findByRole('heading', { name: 'Accepted or expired' })).toBeInTheDocument()
    expect(screen.getByText(/^accepted by bea /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Revoke|Remove/ })).not.toBeInTheDocument()
  })

  it('keeps pending links apart from used and expired ones', async () => {
    renderPanel([accepted, pending, expired])

    const [waiting, done] = await screen.findAllByRole('list')
    expect(within(waiting).getAllByRole('listitem')).toHaveLength(1)
    expect(within(waiting).getByText('Ana')).toBeInTheDocument()
    expect(within(done).getAllByRole('listitem')).toHaveLength(2)
    expect(within(done).getByText(/^expired /)).toBeInTheDocument()
  })

  it('removes an expired link after confirming', async () => {
    const fetchMock = renderPanel([expired])

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cris' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/invitations/i4/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
