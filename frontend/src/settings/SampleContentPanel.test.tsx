import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeedbackProvider } from '../ui/FeedbackProvider'
import { SampleContentPanel } from './SampleContentPanel'

function renderPanel() {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return new Response(JSON.stringify({ authenticated: true, has_sample_content: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url === '/api/auth/sample-content/' && init?.method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider><SampleContentPanel /></FeedbackProvider>
    </QueryClientProvider>,
  )
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('SampleContentPanel', () => {
  it('removes sample content only after confirmation', async () => {
    const fetch = renderPanel()
    expect(screen.queryByRole('heading', { name: 'Sample content' })).not.toBeInTheDocument()
    const remove = await screen.findByRole('button', { name: 'Remove sample content' })
    fireEvent.click(remove)
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/sample-content/', expect.objectContaining({ method: 'DELETE' }))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/sample-content/', expect.objectContaining({ method: 'DELETE' }))

    fireEvent.click(remove)

    fireEvent.click(screen.getByRole('alertdialog', { name: 'Remove sample content?' }).querySelector('button.button-danger')!)
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/auth/sample-content/', expect.objectContaining({ method: 'DELETE' })),
    )
  })
})
