import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddressPanel } from './AddressPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderPanel(saved: string, saveResult?: Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return saveResult ?? jsonResponse({ public_url: 'https://brain.example.com' })
    }
    return jsonResponse({ public_url: saved })
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AddressPanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('AddressPanel', () => {
  it("says links use the browser's address while there is none", async () => {
    renderPanel('')

    expect(await screen.findByRole('textbox', { name: 'Public address' })).toHaveValue('')
    expect(screen.getByText(/right now, http:\/\/localhost/)).toBeInTheDocument()
  })

  it('saves the address', async () => {
    const fetchMock = renderPanel('')

    fireEvent.change(await screen.findByRole('textbox', { name: 'Public address' }), {
      target: { value: ' brain.example.com ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/server/address/',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ public_url: 'brain.example.com' }) }),
    )
  })

  it("shows why an address can't be saved", async () => {
    renderPanel('', jsonResponse({ public_url: ['A blog uses this domain.'] }, 400))

    fireEvent.change(await screen.findByRole('textbox', { name: 'Public address' }), {
      target: { value: 'https://blog.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A blog uses this domain.')
  })
})
