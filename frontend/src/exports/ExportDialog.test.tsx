import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Export } from './api'
import { ExportDialog } from './ExportDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function exportOf(fields: Partial<Export>): Export {
  return {
    id: 'e1',
    status: 'pending',
    size: null,
    filename: 'brain-export-2026-10-29.zip',
    download_url: null,
    created_at: '2026-10-29T12:00:00Z',
    finished_at: null,
    ...fields,
  }
}

function mockApi(latest: Export | null, started?: Export) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? jsonResponse(started, 202)
      : jsonResponse({ results: latest ? [latest] : [] }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderDialog(onClose = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ExportDialog onClose={onClose} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ExportDialog', () => {
  it('starts an export and says it is being prepared', async () => {
    const fetchMock = mockApi(null, exportOf({}))
    renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: 'Create export' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Preparing your export')
    expect(fetchMock).toHaveBeenCalledWith('/api/exports/', expect.objectContaining({ method: 'POST' }))
  })

  it('offers the download of a ready export, and a new one', async () => {
    mockApi(
      exportOf({ status: 'ready', size: 3 * 1024 * 1024, download_url: '/api/exports/e1/download/' }),
    )
    renderDialog()

    const link = await screen.findByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute('href', '/api/exports/e1/download/')
    expect(screen.getByText('brain-export-2026-10-29.zip')).toBeInTheDocument()
    expect(screen.getByText(/3 MB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make a new one' })).toBeInTheDocument()
  })

  it('says when the last export failed', async () => {
    mockApi(exportOf({ status: 'failed' }))
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent('The last export failed')
    expect(screen.getByRole('button', { name: 'Create export' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    mockApi(null)
    const onClose = vi.fn()
    renderDialog(onClose)

    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
