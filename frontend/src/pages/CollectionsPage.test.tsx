import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Collection } from '../items/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { CollectionsPage } from './CollectionsPage'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let collections: Collection[]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  collections = []
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/collections/' && init?.method === 'POST') {
      const created = {
        id: 'new',
        color: '',
        icon: '',
        item_count: 0,
        created_at: '',
        updated_at: '',
        ...JSON.parse(String(init.body)),
      }
      collections = [...collections, created]
      return jsonResponse(created, 201)
    }
    return jsonResponse({ count: collections.length, next: null, previous: null, results: collections })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <CollectionsPage />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CollectionsPage', () => {
  it('creates a collection from the New collection dialog', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    const dialog = screen.getByRole('dialog', { name: 'New collection' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Health' } })
    fireEvent.click(screen.getByRole('radio', { name: /Area/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    const [, init] = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/collections/' && init?.method === 'POST',
    )!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Health', kind: 'area' })
    expect(await screen.findByText('Health')).toBeInTheDocument()
  })

  it("can't create a collection without a name", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
