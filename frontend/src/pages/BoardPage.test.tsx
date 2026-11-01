import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { Board, BoardSummary, Layout } from '../boards/api'
import { emptyLayout } from '../boards/layout'
import type { Item } from '../items/api'
import { FakeLiveServer } from '../test/liveServer'

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
    created_by: '',
    created_via: 'web',
    edited_by: '',
    edited_via: '',
    edited_at: null,
    ...overrides,
  }
}

let board: Board
let items: Item[]
let saves: { layout: Layout; ifMatch: string | null }[]
let patches: { id: string; body: string; ifMatch: string | null }[]
let desktop: boolean
let offline: boolean
let captureFailures: number
let captures: unknown[]

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
  offline = false
  captureFailures = 0
  captures = []
  FakeXHR.sent = []
  localStorage.clear()
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
        if (offline) throw new TypeError('Failed to fetch')
        const layout = JSON.parse(String(init?.body))
        saves.push({ layout, ifMatch: new Headers(init?.headers).get('If-Match') })
        board = { ...board, layout, revision: board.revision + 1 }
        return jsonResponse({ revision: board.revision, layout, updated_at: '' })
      }
      if (url === '/api/items/capture/' && method === 'POST') {
        const { text } = JSON.parse(String(init?.body))
        captures.push(text)
        if (captureFailures > 0) {
          captureFailures--
          return jsonResponse({ detail: 'Service unavailable' }, 503)
        }
        const link = /^https?:/.test(text)
        const item = makeItem(
          link ? { kind: 'link', url: text, title: `Page ${text}` } : { body: text },
        )
        items = [item, ...items]
        return jsonResponse(item, 201)
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

/** XMLHttpRequest double for uploads: each waits until the test answers it. */
class FakeXHR {
  static sent: FakeXHR[] = []
  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  withCredentials = false
  status = 0
  responseText = ''
  open() {}
  setRequestHeader() {}
  send() {
    FakeXHR.sent.push(this)
  }
  abort() {}
  progress(loaded: number, total: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total }))
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    act(() => this.onload?.())
  }
}

/** A DataTransfer double: what `setData` stores, `getData` reads back. */
function transfer(data: Record<string, string> = {}, files: File[] = []) {
  return {
    get types() {
      return [...(files.length ? ['Files'] : []), ...Object.keys(data)]
    },
    files,
    items: files.map((file) => ({
      kind: 'file',
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory: false }),
    })),
    getData: (type: string) => data[type] ?? '',
    setData: (type: string, value: string) => {
      data[type] = value
    },
    dropEffect: 'none',
    effectAllowed: 'all',
  }
}

function dispatch(target: EventTarget, type: string, init: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value })
  }
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function canvas() {
  return document.querySelector('.react-flow')!
}

/** Drags something from outside the app and drops it on `target`. */
function dropFromOutside(target: Element, data: ReturnType<typeof transfer>, x = 0, y = 0) {
  dispatch(target, 'dragenter', { dataTransfer: data })
  expect(screen.getByText('Drop to add to this board')).toBeInTheDocument()
  return dispatch(target, 'drop', { dataTransfer: data, clientX: x, clientY: y })
}

// Layout saves wait for changes to stop for a second.
const SAVED = { timeout: 3000 }

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
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled()
  })

  it('adds an item and saves the layout with its revision', async () => {
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    fireEvent.click(screen.getByRole('button', { name: 'Add items' }))
    const panel = screen.getByRole('complementary', { name: 'Add items' })
    fireEvent.click(await within(panel).findByRole('button', { name: /^Add / }))

    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    expect(saves[0].ifMatch).toBe('"4"')
    expect(saves[0].layout.nodes.map((node) => 'item' in node && node.item)).toEqual(
      items.map((item) => item.id),
    )
    expect(saves[0].layout.nodes[1].w).toBe(280)
    expect(await screen.findAllByText('Waiting in the inbox')).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeEnabled()
  })

  it('keeps the layout on this device while offline and saves it after a reload', async () => {
    offline = true
    const first = renderAt('/boards/b1')
    await screen.findByText('On the board')
    fireEvent.click(screen.getByRole('button', { name: 'Add items' }))
    const panel = screen.getByRole('complementary', { name: 'Add items' })
    fireEvent.click(await within(panel).findByRole('button', { name: /^Add / }))
    expect(await screen.findByText('Offline', {}, SAVED)).toBeInTheDocument()
    first.unmount()

    offline = false
    renderAt('/boards/b1')
    expect(await screen.findAllByText('Waiting in the inbox')).not.toHaveLength(0)
    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    expect(saves[0].ifMatch).toBe('"4"')
    expect(saves[0].layout.nodes).toHaveLength(2)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
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

  it('opens an item in the viewer on double click', async () => {
    placeAll([makeItem({ kind: 'link', url: 'https://example.com/a', title: 'A page' })])
    renderAt('/boards/b1')
    fireEvent.doubleClick(await screen.findByText('A page'))
    const viewer = await screen.findByRole('dialog', { name: 'A page' })
    expect(within(viewer).getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      'https://example.com/a',
    )
    // The board's other card is a step away.
    expect(within(viewer).getByText(/2 of 2/)).toBeInTheDocument()

    fireEvent.click(within(viewer).getByRole('button', { name: 'Remove from board' }))
    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    expect(saves[0].layout.nodes).toHaveLength(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edits a note in its card live, like on the note page', async () => {
    const server = new FakeLiveServer((id) => items.find((item) => item.id === id)?.body ?? '')
    vi.stubGlobal('WebSocket', server.WebSocket)
    vi.stubGlobal('indexedDB', new IDBFactory())
    renderAt('/boards/b1')
    fireEvent.doubleClick(await screen.findByText('On the board'))
    const content = await waitFor(() => {
      const element = document.querySelector('.cm-content')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const view = EditorView.findFromDOM(content)!
    const before = view.state.doc.toString()
    view.dispatch({ changes: { from: 0, insert: 'Written on the board. ' } })
    await waitFor(() => expect(server.text(items[0].id)).toBe(`Written on the board. ${before}`))
    fireEvent.keyDown(content, { key: 'Escape' })

    await waitFor(() => expect(document.querySelector('.cm-content')).toBeNull())
    expect(patches).toEqual([])
    // Editing a note is not a layout change.
    expect(saves).toHaveLength(0)
  })
})

describe('dropping onto the board', () => {
  beforeEach(() => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:local', revokeObjectURL: () => {} }),
    )
  })

  it('places an inbox item dragged from Add items where it is dropped', async () => {
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    fireEvent.click(screen.getByRole('button', { name: 'Add items' }))
    const panel = screen.getByRole('complementary', { name: 'Add items' })
    const row = (await within(panel).findByText('Waiting in the inbox')).closest('li')!
    const data = transfer()
    dispatch(row, 'dragstart', { dataTransfer: data })
    const over = dispatch(canvas(), 'dragover', { dataTransfer: data })
    expect(over.defaultPrevented).toBe(true)
    dispatch(canvas(), 'drop', { dataTransfer: data, clientX: 500, clientY: 300 })
    dispatch(row, 'dragend', { dataTransfer: data })

    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    // Held near its top, in the middle: the pointer is 140 in and 24 down.
    expect(saves[0].layout.nodes[1]).toMatchObject({ item: items[1].id, x: 360, y: 276, w: 280 })
    // Not a capture: nothing new was created.
    expect(captures).toHaveLength(0)
  })

  it('captures a pasted link onto the board instead of only the inbox', async () => {
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    dispatch(document.body, 'paste', {
      clipboardData: transfer({ 'text/plain': 'https://example.com/pasted' }),
    })

    expect(await screen.findByText('Page https://example.com/pasted')).toBeInTheDocument()
    expect(captures).toEqual(['https://example.com/pasted'])
    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    expect(saves[0].layout.nodes[1]).toMatchObject({ item: items[0].id, w: 340 })
    // No inbox toast: taking the card off the board is the undo here.
    expect(screen.queryByText(/Captured/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeEnabled()
  })

  it('shows a failed drop where it fell, and places it once a retry works', async () => {
    captureFailures = 1
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    dropFromOutside(canvas(), transfer({ 'text/uri-list': 'https://example.com/dropped' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable')
    expect(saves).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Page https://example.com/dropped')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
  })

  it('shows upload progress on the board, then the image card', async () => {
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    const image = new File(['x'.repeat(10)], 'sun.png', { type: 'image/png' })
    dropFromOutside(canvas(), transfer({}, [image]), 600, 400)

    await waitFor(() => expect(FakeXHR.sent).toHaveLength(1))
    FakeXHR.sent[0].progress(5, 10)
    expect(screen.getByRole('progressbar', { name: 'Uploading sun.png' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
    const created = makeItem({
      kind: 'image',
      metadata: { filename: 'sun.png' },
      preview_status: 'pending',
    })
    FakeXHR.sent[0].respond(201, created)
    // The worker makes the thumbnail meanwhile.
    items = [{ ...created, preview_status: 'ready', preview_image_url: '/thumb/sun.webp' }, ...items]

    await waitFor(() => expect(saves).toHaveLength(1), SAVED)
    expect(saves[0].layout.nodes[1]).toMatchObject({ item: created.id, x: 470, y: 376, w: 260 })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // Captured after the board loaded, it still picks up its thumbnail.
    await waitFor(
      () => expect(document.querySelector('img[src="/thumb/sun.webp"]')).not.toBeNull(),
      { timeout: 4000 },
    )
  })

  it('leaves drops on the phone to the inbox', async () => {
    desktop = false
    renderAt('/boards/b1')
    await screen.findByText('On the board')
    dispatch(document.body, 'paste', {
      clipboardData: transfer({ 'text/plain': 'just a thought' }),
    })
    await waitFor(() => expect(captures).toEqual(['just a thought']))
    expect(await screen.findByText(/Captured 1 item/)).toBeInTheDocument()
    expect(saves).toHaveLength(0)
  })
})
