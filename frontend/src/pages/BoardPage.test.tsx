import { EditorView } from '@codemirror/view'
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
let patches: { id: string; body: string; ifMatch: string | null }[]
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
      nodes: [
        { id: 'n1', type: 'item', item: placed.id, x: 0, y: 0, w: 280, h: null, parent: null },
      ],
    },
    items: [placed],
  }
  saves = []
  patches = []
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
      const detail = url.match(/^\/api\/items\/([0-9a-f-]+)\/$/)
      if (detail && method === 'PATCH') {
        const { body } = JSON.parse(String(init?.body))
        patches.push({ id: detail[1], body, ifMatch: new Headers(init?.headers).get('If-Match') })
        const item = items.find((candidate) => candidate.id === detail[1])!
        Object.assign(item, { body, version: `v${patches.length + 1}` })
        return jsonResponse(item)
      }
      if (detail) return jsonResponse(items.find((candidate) => candidate.id === detail[1]))
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

describe('board cards', () => {
  function placeAll(extra: Item[]) {
    items = [...items, ...extra]
    board = {
      ...board,
      items: [...board.items, ...extra],
      layout: {
        ...board.layout,
        nodes: [
          ...board.layout.nodes,
          ...extra.map((item, i) => ({
            id: `x${i}`,
            type: 'item' as const,
            item: item.id,
            // At the origin: jsdom has no size, so only cards there are "visible".
            x: 0,
            y: 0,
            w: 300,
            h: null,
            parent: null,
          })),
        ],
      },
    }
  }

  it('shows each kind of item as its card', async () => {
    placeAll([
      makeItem({
        kind: 'link',
        url: 'https://example.com/a',
        metadata: { title: 'A page', site_name: 'Example' },
        preview_status: 'ready',
      }),
      makeItem({ kind: 'file', metadata: { filename: 'plan.pdf', mime: 'application/pdf' } }),
      makeItem({ kind: 'image', metadata: { filename: 'sun.png' }, file_url: '/f/sun.png' }),
      makeItem({ kind: 'note', body: '- [ ] milk', status: 'archived' }),
    ])
    renderAt('/boards/b1')
    // Cards stay hidden until React Flow measures them, which jsdom can't:
    // query by text, not by role.
    expect((await screen.findByText('A page')).closest('a')).toHaveAttribute(
      'href',
      'https://example.com/a',
    )
    expect(screen.getByText('plan.pdf')).toBeInTheDocument()
    // On the canvas a click selects: the image doesn't open the original.
    expect(screen.getByText('sun.png').closest('a')).toBeNull()
    expect(document.querySelector('input[data-task-line]')).not.toBeChecked()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('opens an item in the side panel on double click', async () => {
    placeAll([makeItem({ kind: 'link', url: 'https://example.com/a', title: 'A page' })])
    renderAt('/boards/b1')
    fireEvent.doubleClick(await screen.findByText('A page'))
    const panel = await screen.findByRole('complementary', { name: 'Item' })
    expect(within(panel).getByRole('link', { name: 'A page' })).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Remove from board' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].layout.nodes).toHaveLength(1)
    expect(screen.queryByRole('complementary', { name: 'Item' })).not.toBeInTheDocument()
  })

  it('edits a note in its card and saves it like the note page', async () => {
    renderAt('/boards/b1')
    fireEvent.doubleClick(await screen.findByText('On the board'))
    const content = await waitFor(() => {
      const element = document.querySelector('.cm-content')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const view = EditorView.findFromDOM(content)!
    view.dispatch({ changes: { from: 0, insert: 'Written on the board' } })
    fireEvent.keyDown(content, { key: 'Escape' })

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({ id: items[0].id, body: 'Written on the board', ifMatch: '"v1"' })
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeNull())
    expect(await screen.findByText('Written on the board')).toBeInTheDocument()
    // Editing a note is not a layout change.
    expect(saves).toHaveLength(0)
  })
})
