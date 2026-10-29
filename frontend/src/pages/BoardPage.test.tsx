import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { Board, BoardSummary, Layout } from '../boards/api'
import { emptyLayout } from '../boards/layout'
import type { Item } from '../items/api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeItem(overrides: Partial<Item>): Item {
  return {
    id: crypto.randomUUID(),
    kind: 'note',
    status: 'inbox',
    title: '',
    body: '',
    url: '',
    metadata: {},
    preview_status: '',
    preview_image_url: null,
    file_url: null,
    collections: [],
    version: 'v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

let board: Board
let items: Item[]
let saves: { layout: Layout; ifMatch: string | null }[]
let desktop: boolean

function summary(): BoardSummary {
  const { layout: _layout, items: _items, ...rest } = board
  return rest
}

beforeEach(() => {
  const placed = makeItem({ title: 'On the board', status: 'organized' })
  items = [placed, makeItem({ title: 'Waiting in the inbox' })]
  board = {
    id: 'b1',
    title: 'Trip',
    item_count: 1,
    revision: 4,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    layout: {
      ...emptyLayout(),
      nodes: [{ id: 'n1', type: 'item', item: placed.id, x: 0, y: 0, w: 280, h: null, parent: null }],
    },
    items: [placed],
  }
  saves = []
  desktop = true
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url === '/api/auth/session/') {
        return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
      }
      if (url.startsWith('/api/boards/?')) return jsonResponse({ count: 1, results: [summary()] })
      if (url === '/api/boards/' && method === 'POST') {
        const { title } = JSON.parse(String(init?.body))
        return jsonResponse({ ...summary(), id: 'b2', title, item_count: 0, revision: 1 }, 201)
      }
      if (url === '/api/boards/b1/') return jsonResponse(board)
      if (url === '/api/boards/b1/layout/' && method === 'PUT') {
        const layout = JSON.parse(String(init?.body))
        saves.push({ layout, ifMatch: new Headers(init?.headers).get('If-Match') })
        board = { ...board, layout, revision: board.revision + 1 }
        return jsonResponse({ revision: board.revision, layout, updated_at: '' })
      }
      if (url.startsWith('/api/items/?')) {
        const status = new URL(url, 'http://x').searchParams.get('status')
        const results = items.filter((item) => !status || item.status === status)
        return jsonResponse({ count: results.length, next: null, previous: null, results })
      }
      return jsonResponse({ detail: 'Not found' }, 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('boards', () => {
  it('lists boards and opens a new one', async () => {
    renderAt('/boards')
    expect(await screen.findByText('Trip')).toBeInTheDocument()
    expect(screen.getByText(/1 item/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('New board'), { target: { value: 'Ideas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/boards/b2'))
  })

  it('shows the items of a board', async () => {
    renderAt('/boards/b1')
    expect(await screen.findByText('On the board')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('adds an item and saves the layout with its revision', async () => {
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    fireEvent.click(screen.getByRole('button', { name: 'Add items' }))
    const panel = screen.getByRole('complementary', { name: 'Add items' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Add' }))

    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].ifMatch).toBe('"4"')
    expect(saves[0].layout.nodes.map((node) => node.item)).toEqual(items.map((item) => item.id))
    expect(saves[0].layout.nodes[1].w).toBe(280)
    expect(await screen.findAllByText('Waiting in the inbox')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('is read-only on a phone', async () => {
    desktop = false
    renderAt('/boards/b1')
    expect(await screen.findByText('On the board')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add items' })).not.toBeInTheDocument()
  })
})
