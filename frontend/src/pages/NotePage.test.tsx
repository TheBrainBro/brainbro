import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { Item } from '../items/api'

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
    ...overrides,
  }
}

let items: Item[]
let patches: { id: string; body: string; ifMatch: string | null }[]
let captures: unknown[]
let conflictWith: string | null

function setUp() {
  items = []
  patches = []
  captures = []
  conflictWith = null
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/auth/session/') {
      return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
    }
    if (url === '/api/items/capture/') {
      const payload = JSON.parse(String(init?.body))
      captures.push(payload)
      const item = makeItem({ body: payload.text, version: `v-${payload.text}` })
      items = [item, ...items]
      return jsonResponse(item, 201)
    }
    const detail = url.match(/^\/api\/items\/([^/]+)\/$/)
    if (detail) {
      const item = items.find((candidate) => candidate.id === detail[1])
      if (!item) return jsonResponse({ detail: 'Not found.' }, 404)
      if (method === 'PATCH') {
        const { body } = JSON.parse(String(init?.body))
        const ifMatch = new Headers(init?.headers).get('If-Match')
        patches.push({ id: item.id, body, ifMatch })
        if (conflictWith !== null) {
          Object.assign(item, { body: conflictWith, version: `v-${conflictWith}` })
          conflictWith = null
          return jsonResponse(item, 412)
        }
        Object.assign(item, { body, version: `v-${body}` })
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
  const content = await screen.findByRole('textbox', { name: 'Note' })
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

  it('autosaves edits with the version they started from', async () => {
    items = [makeItem({ id: 'n1', body: MARKDOWN, version: 'v-start' })]
    renderAt('/notes/n1')
    const view = await editor()
    expect(await screen.findByText('Saved')).toBeInTheDocument()

    type(view, 'more')
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 })
    expect(patches[0]).toEqual({ id: 'n1', body: `${MARKDOWN}more`, ifMatch: '"v-start"' })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('creates a new note through the capture pipeline once it has text', async () => {
    renderAt('/notes/new')
    const view = await editor()
    type(view, 'https://example.com is a note here')

    await waitFor(() => expect(captures).toHaveLength(1), { timeout: 3000 })
    expect(captures[0]).toEqual({ text: 'https://example.com is a note here', kind: 'note' })
    const id = items[0].id
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/notes/${id}`))

    // Same editor, now saving to the created note.
    expect(await editor()).toBe(view)
    type(view, '!')
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 })
    expect(patches[0].body).toBe('https://example.com is a note here!')
  })

  it('shows a conflict and can load the other tab’s text', async () => {
    items = [makeItem({ id: 'n1', body: 'start', version: 'v-start' })]
    renderAt('/notes/n1')
    const view = await editor()
    conflictWith = 'from another tab'

    type(view, ' mine')
    expect(
      await screen.findByText(/changed in another tab/, {}, { timeout: 3000 }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load latest' }))
    expect((await editor()).state.doc.toString()).toBe('from another tab')
    expect(screen.queryByText(/changed in another tab/)).toBeNull()
  })

  it('restores an unsaved draft after a reload', async () => {
    items = [makeItem({ id: 'n1', body: 'start', version: 'v-start' })]
    localStorage.setItem(
      'brain:note-draft:n1',
      JSON.stringify({ body: 'start, then offline', base: 'v-start' }),
    )
    renderAt('/notes/n1')
    expect((await editor()).state.doc.toString()).toBe('start, then offline')
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 })
    expect(patches[0].body).toBe('start, then offline')
  })
})
