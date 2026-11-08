import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { Item } from '../items/api'
import { FakeLiveServer } from '../test/liveServer'

const MARKDOWN = '# Title\n\n* star bullet\n__bold__ and *em*\\\nhard break\n\n    indented code\n'

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
    public_slug: null,
    public_url: null,
    published_at: null,
    ...overrides,
  }
}

let items: Item[]
let patches: { id: string; body?: string; title?: string }[]
let captures: unknown[]
let triages: { ids: string[]; action: string }[]
let server: FakeLiveServer
// When set, creating a note waits for it: as a slow network would.
let captureGate: Promise<void> | null

function setUp() {
  items = []
  patches = []
  captures = []
  triages = []
  captureGate = null
  // Notes open live: the server builds each one's document from its body.
  server = new FakeLiveServer((id) => items.find((item) => item.id === id)?.body ?? '')
  vi.stubGlobal('WebSocket', server.WebSocket)
  // A fresh device: nothing kept from other tests.
  vi.stubGlobal('indexedDB', new IDBFactory())
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/auth/session/') {
      return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
    }
    if (url === '/api/items/triage/') {
      const payload = JSON.parse(String(init?.body))
      triages.push(payload)
      for (const item of items.filter((candidate) => payload.ids.includes(candidate.id))) {
        if (payload.action === 'archive') item.status = 'archived'
      }
      if (payload.action === 'delete') {
        items = items.filter((item) => !payload.ids.includes(item.id))
      }
      return jsonResponse([])
    }
    if (url === '/api/items/capture/') {
      const payload = JSON.parse(String(init?.body))
      captures.push(payload)
      await captureGate
      const item = makeItem({ body: payload.text, version: `v-${payload.text}` })
      items = [item, ...items]
      return jsonResponse(item, 201)
    }
    if (url.startsWith('/api/revisions/?item=')) {
      const at = new Date().toISOString()
      const revision = { item: 'n1', board: null, title: '', by: 'Claude', via: 'mcp' }
      return jsonResponse({
        count: 1,
        next: null,
        results: [
          { ...revision, id: 'r1', restored_from: null, restored_from_at: null, created_at: at, updated_at: at },
        ],
      })
    }
    if (url === '/api/revisions/r1/') {
      return jsonResponse({ id: 'r1', item: 'n1', title: '', body: items[0].body, by: 'Claude', via: 'mcp' })
    }
    const detail = url.match(/^\/api\/items\/([^/]+)\/$/)
    if (detail) {
      const item = items.find((candidate) => candidate.id === detail[1])
      if (!item) return jsonResponse({ detail: 'Not found.' }, 404)
      if (method === 'PATCH') {
        const changes = JSON.parse(String(init?.body)) as { body?: string; title?: string }
        patches.push({ id: item.id, ...changes })
        Object.assign(item, changes, {
          version: `v-${changes.body ?? changes.title}`,
        })
      }
      return jsonResponse(item)
    }
    return jsonResponse({ count: items.length, next: null, previous: null, results: items })
  })
  vi.stubGlobal('fetch', fetchMock)
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
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

async function editor() {
  // A live note shows once it has synced, which can take a moment under load.
  const content = await screen.findByRole('textbox', { name: 'Note' }, { timeout: 3000 })
  return EditorView.findFromDOM(content)!
}

function type(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }))
}

beforeEach(() => {
  setUp()
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NotePage', () => {
  it('opens a note from the inbox with its Markdown exactly as stored', async () => {
    items = [makeItem({ id: 'n1', body: MARKDOWN })]
    renderAt('/')
    fireEvent.click(await screen.findByRole('heading', { name: 'Title' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/notes/n1')
    const view = await editor()
    expect(view.state.doc.toString()).toBe(MARKDOWN)
  })

  it("spellchecks with the browser's own language, not the UI's", async () => {
    items = [makeItem({ id: 'n1', body: MARKDOWN })]
    renderAt('/notes/n1')
    const view = await editor()

    expect(view.contentDOM).toHaveAttribute('spellcheck', 'true')
    expect(view.contentDOM).toHaveAttribute('lang', '')
  })

  it('lets people update a note title separately from its body', async () => {
    items = [makeItem({ id: 'n1', title: 'Start here: your second brain', body: 'The note body.' })]
    renderAt('/notes/n1')
    await editor()

    const title = await screen.findByRole('textbox', { name: 'Note title' })
    expect(title).toHaveValue('Start here: your second brain')
    fireEvent.change(title, { target: { value: 'A clearer title' } })
    fireEvent.blur(title)

    await waitFor(() => expect(patches).toEqual([{ id: 'n1', title: 'A clearer title' }]))
    expect(title).toHaveValue('A clearer title')
    expect(server.text('n1')).toBe('The note body.')
  })

  it('edits live: typing reaches the server, and edits made elsewhere show up in place', async () => {
    items = [makeItem({ id: 'n1', body: 'start' })]
    renderAt('/notes/n1')
    const view = await editor()
    expect(await screen.findByText('Saved')).toBeInTheDocument()

    type(view, ', mine')
    await waitFor(() => expect(server.text('n1')).toBe('start, mine'))
    server.edit('n1', (text) => text.insert(0, 'Theirs: '))
    await waitFor(() => expect(view.state.doc.toString()).toBe('Theirs: start, mine'))
    // No saves of the whole text, and so no conflicts.
    expect(patches).toEqual([])
  })

  it('shows who else is in the note, and an assistant that edits it', async () => {
    items = [makeItem({ id: 'n1', body: 'start' })]
    renderAt('/notes/n1')
    const view = await editor()

    server.edit('n1', (text) => text.insert(5, ', from Claude'), { name: 'Claude', color: '#7c3aed' })
    await waitFor(() => expect(view.state.doc.toString()).toBe('start, from Claude'))
    expect(await screen.findByLabelText('Also here: Claude')).toBeInTheDocument()
  })

  it('keeps editing offline and merges when back', async () => {
    items = [makeItem({ id: 'n1', body: 'start' })]
    renderAt('/notes/n1')
    const view = await editor()
    await screen.findByText('Saved')

    act(() => server.drop())
    expect(await screen.findByText('Offline, kept on this device', {}, { timeout: 3000 })).toBeInTheDocument()
    type(view, ' offline')
    server.edit('n1', (text) => text.insert(0, 'Meanwhile, '))
    server.up()

    await waitFor(() => expect(server.text('n1')).toBe('Meanwhile, start offline'), { timeout: 5000 })
    await waitFor(() => expect(view.state.doc.toString()).toBe('Meanwhile, start offline'))
  })

  it('creates a new note through the capture pipeline, then edits it live', async () => {
    let release!: () => void
    captureGate = new Promise((resolve) => (release = resolve))
    renderAt('/notes/new')
    const view = await editor()
    type(view, 'https://example.com is a note here')

    await waitFor(() => expect(captures).toHaveLength(1), { timeout: 3000 })
    expect(captures[0]).toEqual({ text: 'https://example.com is a note here', kind: 'note' })
    // Typed while it is being created: it goes live too.
    type(view, '!')
    release()
    await waitFor(() => expect(items).toHaveLength(1))
    const id = items[0].id
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/notes/${id}`))

    await waitFor(() => expect(server.text(id)).toBe('https://example.com is a note here!'))
    type(await editor(), '?')
    await waitFor(() => expect(server.text(id)).toBe('https://example.com is a note here!?'))
    expect(captures).toHaveLength(1)
    expect(patches).toEqual([])
  })

  it('restores the draft of a new note after a reload', async () => {
    localStorage.setItem('brainbro:note-draft:new', JSON.stringify({ body: 'from before' }))
    renderAt('/notes/new')
    expect((await editor()).state.doc.toString()).toBe('from before')
    await waitFor(() => expect(captures).toEqual([{ text: 'from before', kind: 'note' }]), {
      timeout: 3000,
    })
  })

  it('archives the note from its header and goes back', async () => {
    items = [makeItem({ id: 'n1', body: 'keep this' })]
    renderAt('/notes/n1')
    await editor()
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    await waitFor(() => expect(triages).toEqual([{ ids: ['n1'], action: 'archive' }]))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
  })

  it('opens the history from its header', async () => {
    items = [makeItem({ id: 'n1', body: 'start' })]
    renderAt('/notes/n1')
    await editor()

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'History' }))

    const dialog = await screen.findByRole('dialog', { name: 'Note history' })
    const list = await within(dialog).findByRole('list', { name: 'Revisions' })
    expect(list).toHaveTextContent('Claude')
    expect(list).toHaveTextContent('Current version')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('deletes the note', async () => {
    items = [makeItem({ id: 'n1', body: 'start' })]
    renderAt('/notes/n1')
    await editor()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this note?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(triages).toEqual([{ ids: ['n1'], action: 'delete' }]))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    expect(patches).toEqual([])
  })

  it('prints the note as a document, named after its first line, with the latest text', async () => {
    items = [makeItem({ id: 'n1', body: '# Trip plan\n\nPack **light**' })]
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderAt('/notes/n1')
    const view = await editor()
    type(view, ' and early')
    const title = document.title

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export PDF' }))
    await waitFor(() => expect(print).toHaveBeenCalledOnce())
    const page = document.querySelector('.print-root')!
    expect(page.querySelector('h1')).toHaveTextContent('Trip plan')
    expect(page).toHaveTextContent('Pack light and early')
    expect(document.title).toBe('Trip plan')

    act(() => window.dispatchEvent(new Event('afterprint')))
    expect(document.querySelector('.print-root')).toBeNull()
    expect(document.title).toBe(title)
  })

  it('prints the note on Cmd+P instead of the page', async () => {
    items = [makeItem({ id: 'n1', body: 'short note' })]
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderAt('/notes/n1')
    await editor()

    const event = new KeyboardEvent('keydown', { key: 'p', metaKey: true, cancelable: true })
    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(print).toHaveBeenCalledOnce())
    expect(document.querySelector('.print-root')).toHaveTextContent('short note')
  })
})
