import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ItemList } from './ItemList'
import type { Collection, Item } from './api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function note(id: string, body: string): Item {
  return {
    id,
    kind: 'note',
    status: 'inbox',
    title: '',
    body,
    url: '',
    metadata: {},
    preview_status: '',
    preview_image_url: null,
    file_url: null,
    collections: [],
    version: 'v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

const items = [note('a', 'First'), note('b', 'Second'), note('c', 'Third')]
let collections: Collection[]
let fetchMock: ReturnType<typeof vi.fn>

function triageCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/items/triage/')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

beforeEach(() => {
  collections = [
    {
      id: 'work',
      name: 'Work',
      kind: 'project',
      color: '',
      icon: '',
      item_count: 0,
      created_at: '',
      updated_at: '',
    },
  ]
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/collections/' && init?.method === 'POST') {
      const created = { ...collections[0], id: 'new', ...JSON.parse(String(init.body)) }
      collections = [...collections, created]
      return jsonResponse(created, 201)
    }
    if (url.startsWith('/api/collections/')) {
      return jsonResponse({ count: collections.length, next: null, previous: null, results: collections })
    }
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ItemList items={items} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function card(text: string) {
  return screen.getByText(text).closest('article') as HTMLElement
}

describe('ItemList triage', () => {
  it('archives a single item from its card', async () => {
    renderList()
    fireEvent.click(within(card('Second')).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(triageCalls()).toEqual([{ ids: ['b'], action: 'archive' }]))
  })

  it('bulk deletes the selection after confirming', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderList()
    fireEvent.click(within(card('First')).getByRole('checkbox', { name: 'Select' }))
    fireEvent.click(within(card('Third')).getByRole('checkbox', { name: 'Select' }))

    const toolbar = screen.getByRole('toolbar', { name: 'Selection' })
    expect(toolbar).toHaveTextContent('2 selected')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))

    expect(confirm).toHaveBeenCalledWith('Delete 2 items?')
    await waitFor(() => expect(triageCalls()).toEqual([{ ids: ['a', 'c'], action: 'delete' }]))
  })

  it('does not delete when the confirmation is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderList()
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Delete' }))
    expect(triageCalls()).toEqual([])
  })

  it('supports keyboard triage: j/k to move, x to select, e to archive', async () => {
    renderList()
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(card('Second')).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'k' })
    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyDown(window, { key: 'e' })
    await waitFor(() => expect(triageCalls()).toEqual([{ ids: ['a', 'b'], action: 'archive' }]))
  })

  it('organizes into an existing and a newly created collection', async () => {
    renderList()
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Organize' }))

    const dialog = await screen.findByRole('dialog', { name: 'Organize into collections' })
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Work/ }))

    const input = within(dialog).getByLabelText('Find or create a collection')
    fireEvent.change(input, { target: { value: 'Reading' } })
    expect(within(dialog).getByText('Enter to create “Reading”')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(''))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Organize' }))
    await waitFor(() =>
      expect(triageCalls()).toEqual([{ ids: ['a'], action: 'organize', collections: ['work', 'new'] }]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
