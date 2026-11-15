import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Storage } from './api'
import { StoragePanel } from './StoragePanel'

const MB = 1024 * 1024

function mockApi(storage: Storage | null) {
  const fetchMock = vi.fn(async () =>
    storage
      ? new Response(JSON.stringify(storage), { headers: { 'Content-Type': 'application/json' } })
      : new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <StoragePanel />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('StoragePanel', () => {
  it('shows what is used and what is left of the quota', async () => {
    const fetchMock = mockApi({ used: 300 * MB, quota: 1024 * MB })
    renderPanel()

    expect(await screen.findByText('300 MB of 1 GB used')).toBeInTheDocument()
    expect(screen.getByText('724 MB left')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Storage used' })).toHaveAttribute(
      'aria-valuenow',
      String(300 * MB),
    )
    expect(screen.queryByText(/storage is full/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/storage/', expect.anything())
  })

  it('says when the storage is full', async () => {
    mockApi({ used: 1100 * MB, quota: 1024 * MB })
    renderPanel()

    expect(await screen.findByText('0 B left')).toBeInTheDocument()
    expect(screen.getByText(/storage is full/)).toBeInTheDocument()
  })

  it('shows only what is used without a quota', async () => {
    mockApi({ used: 3 * MB, quota: null })
    renderPanel()

    expect(await screen.findByText('3 MB used. This server sets no limit.')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })

  it('says when it could not load', async () => {
    mockApi(null)
    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your storage')
  })
})
