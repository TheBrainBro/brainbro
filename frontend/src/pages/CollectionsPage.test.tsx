import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptureProvider } from '../capture/CaptureProvider'
import type { Collection } from '../items/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { CollectionPage, CollectionsPage } from './CollectionsPage'

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
    if (url.startsWith('/api/collections/work/') && init?.method === 'PATCH') {
      collections = [{ ...collections[0], ...JSON.parse(String(init.body)) }]
      return jsonResponse(collections[0])
    }
    if (url.startsWith('/api/collections/work/') && init?.method === 'DELETE') {
      collections = []
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('/api/items/')) {
      return jsonResponse({ count: 0, next: null, previous: null, results: [] })
    }
    if (url === '/api/collections/' && init?.method === 'POST') {
      const created = {
        id: 'new',
        color: '',
        icon: '',
        image_url: null,
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
    fireEvent.click(screen.getByRole('button', { name: '🏃' }))
    fireEvent.click(screen.getByRole('radio', { name: '#22c55e' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    const [, init] = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/collections/' && init?.method === 'POST',
    )!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: 'Health',
      kind: 'area',
      icon: '🏃',
      color: '#22c55e',
    })
    expect(await screen.findByText('Health')).toBeInTheDocument()
  })

  it("can't create a collection without a name", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'New collection' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})

const work: Collection = {
  id: 'work',
  name: 'Work',
  kind: 'project',
  color: '',
  icon: '',
  image_url: null,
  item_count: 2,
  created_at: '',
  updated_at: '',
}

function renderCollection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/collections/work']}>
        <FeedbackProvider>
          <CaptureProvider>
            <Routes>
              <Route path="/collections/:id" element={<CollectionPage />} />
              <Route path="/collections" element={<p>All collections</p>} />
            </Routes>
          </CaptureProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CollectionPage', () => {
  it('renames a collection', async () => {
    collections = [work]
    renderCollection()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit collection' }))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Work')
    fireEvent.change(name, { target: { value: 'Job' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('heading', { name: 'Job' })).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ name: 'Job' })
  })

  it('deletes a collection, archiving the items only in it', async () => {
    collections = [work]
    renderCollection()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete collection' }))
    const dialog = screen.getByRole('alertdialog')
    expect(screen.getByRole('radio', { name: /Move them to the inbox/ })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: /Archive them/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete collection' }))

    expect(await screen.findByText('All collections')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/collections/work/?items=archive',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Deleted Work')
  })
})
