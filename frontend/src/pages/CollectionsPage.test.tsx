import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptureProvider } from '../capture/CaptureProvider'
import type { Collection, Item } from '../items/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { CollectionPage, CollectionsPage } from './CollectionsPage'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let collections: Collection[]
let collectionItems: Item[]
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  collections = []
  collectionItems = []
  localStorage.clear()
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/move/')) return new Response(null, { status: 204 })
    if (url.startsWith('/api/collections/work/') && init?.method === 'PATCH') {
      collections = [{ ...collections[0], ...JSON.parse(String(init.body)) }]
      return jsonResponse(collections[0])
    }
    if (url.startsWith('/api/collections/work/') && init?.method === 'DELETE') {
      collections = []
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('/api/items/')) {
      const results = collectionItems.filter((item) => url.includes(`collection=${item.collections[0]}`))
      return jsonResponse({ count: results.length, next: null, previous: null, results })
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
      parent: null,
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
  parent: null,
  item_count: 2,
  created_at: '',
  updated_at: '',
}

function renderCollection(id = 'work') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/collections/${id}`]}>
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

  it('renames a collection by clicking its name', async () => {
    collections = [work]
    renderCollection()
    const name = await screen.findByLabelText('Collection name')
    expect(name).toHaveValue('Work')
    fireEvent.change(name, { target: { value: 'Job' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.blur(name)

    const patch = () => fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    await waitFor(() => expect(patch()).toBeDefined())
    const [, init] = patch()!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ name: 'Job' })
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

  it('shows where it sits, and the collections inside it', async () => {
    collections = [work, clients, acme]
    renderCollection('acme')
    const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Work' })).toHaveAttribute(
      'href',
      '/collections/work',
    )
    expect(within(breadcrumb).getByRole('link', { name: 'Clients' })).toBeInTheDocument()
  })

  it('lists the collections inside it, and creates one there', async () => {
    collections = [work, clients]
    renderCollection()
    const inside = await screen.findByRole('list', { name: 'Collections inside' })
    expect(within(inside).getByRole('link', { name: /Clients/ })).toHaveAttribute(
      'href',
      '/collections/clients',
    )

    fireEvent.click(screen.getByRole('button', { name: 'New collection inside' }))
    expect(screen.getByLabelText('Inside')).toHaveValue('work')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Suppliers' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Created Suppliers in Work'),
    )
    const [, init] = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      name: 'Suppliers',
      parent: 'work',
    })
  })

  it('moves a collection anywhere but inside itself', async () => {
    collections = [work, clients, acme, home]
    renderCollection()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit collection' }))
    const inside = screen.getByLabelText('Inside')
    const options = within(inside)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Nothing, at the top', 'Home'])

    fireEvent.change(inside, { target: { value: 'home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const patch = () => fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
    await waitFor(() => expect(patch()).toBeDefined())
    const [, init] = patch()!
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ parent: 'home' })
  })

  it('says the collections inside move up when it is deleted', async () => {
    collections = [work, clients]
    renderCollection()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete collection' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'The collection inside it moves to the top.',
    )
  })
})

const clients: Collection = { ...work, id: 'clients', name: 'Clients', parent: 'work', item_count: 1 }
const acme: Collection = { ...work, id: 'acme', name: 'Acme', parent: 'clients', item_count: 0 }
const home: Collection = { ...work, id: 'home', name: 'Home', item_count: 0 }

function note(id: string, body: string, collection: string): Item {
  return {
    id,
    kind: 'note',
    status: 'organized',
    title: '',
    body,
    url: '',
    metadata: {},
    preview_status: '',
    preview_image_url: null,
    file_url: null,
    collections: [collection],
    version: 'v1',
    created_at: '',
    updated_at: '',
    created_by: '',
    created_via: 'web',
    edited_by: '',
    edited_via: '',
    edited_at: null,
    public_slug: null,
    public_url: null,
    published_at: null,
  }
}

describe('Collections tree', () => {
  it('shows the top collections, and opens one into what is inside it', async () => {
    collections = [work, clients, acme, home]
    collectionItems = [note('n1', 'Plan the launch', 'work'), note('n2', 'Call Acme', 'clients')]
    renderPage()
    const tree = await screen.findByRole('list', { name: 'Collections' })
    expect(within(tree).getByRole('link', { name: /Work/ })).toHaveTextContent(
      'Project · 2 items · 1 collection',
    )
    expect(within(tree).getByRole('link', { name: /Home/ })).toBeInTheDocument()
    expect(within(tree).queryByRole('link', { name: /Clients/ })).toBeNull()
    // Nothing inside: nothing to open.
    expect(screen.queryByRole('button', { name: 'Open Home' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open Work' }))
    const inWork = screen.getByRole('list', { name: 'In Work' })
    expect(within(inWork).getByRole('link', { name: /Clients/ })).toBeInTheDocument()
    expect(await within(inWork).findByRole('button', { name: /Plan the launch/ })).toBeInTheDocument()
    expect(within(inWork).queryByText('Call Acme')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open Clients' }))
    expect(await screen.findByRole('button', { name: /Call Acme/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close Work' })).toHaveAttribute('aria-expanded', 'true')
  })
})

function moveCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/move/'))
    .map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))])
}

const transfer = () => ({ effectAllowed: '', dropEffect: '', setData: () => {} })

/** A tree row: what is dragged, and dropped on. */
function row(name: string) {
  return screen.getByRole('link', { name: new RegExp(name) }).parentElement!
}

/** jsdom has no DragEvent: without one, drags carry no pointer position. */
class DragEventWithPosition extends MouseEvent {}

/** Rows 40px tall from the top of the page: `y` picks the edge or the middle. */
function dragOnto(target: HTMLElement, y: number, dataTransfer: ReturnType<typeof transfer>) {
  target.getBoundingClientRect = () => ({ top: 0, height: 40 }) as DOMRect
  fireEvent.dragOver(target, { dataTransfer, clientY: y })
  fireEvent.drop(target, { dataTransfer, clientY: y })
}

describe('Sorting the tree', () => {
  beforeEach(() => {
    vi.stubGlobal('DragEvent', DragEventWithPosition)
  })

  it('drops a collection inside another', async () => {
    collections = [work, home]
    renderPage()
    await screen.findByRole('list', { name: 'Collections' })
    const dataTransfer = transfer()
    fireEvent.dragStart(row('Home'), { dataTransfer })
    dragOnto(row('Work'), 20, dataTransfer)
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        ['/api/collections/home/move/', { parent: 'work', after: null }],
      ]),
    )
  })

  it('drops a collection before or after another', async () => {
    collections = [work, home]
    renderPage()
    await screen.findByRole('list', { name: 'Collections' })
    let dataTransfer = transfer()
    fireEvent.dragStart(row('Home'), { dataTransfer })
    dragOnto(row('Work'), 2, dataTransfer)
    dataTransfer = transfer()
    fireEvent.dragStart(row('Work'), { dataTransfer })
    dragOnto(row('Home'), 38, dataTransfer)
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        ['/api/collections/home/move/', { parent: null, after: null }],
        ['/api/collections/work/move/', { parent: null, after: 'home' }],
      ]),
    )
  })

  it("won't drop a collection inside one of its own", async () => {
    collections = [work, clients]
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Work' }))
    const dataTransfer = transfer()
    fireEvent.dragStart(row('Work'), { dataTransfer })
    dragOnto(row('Clients'), 20, dataTransfer)
    expect(row('Clients')).not.toHaveClass('ring-2')
    expect(moveCalls()).toEqual([])
  })

  it('moves the focused collection with Alt+arrows', async () => {
    collections = [work, home]
    renderPage()
    const link = await screen.findByRole('link', { name: /Work/ })
    // Already first: nowhere to go.
    fireEvent.keyDown(link, { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(link, { key: 'ArrowDown', altKey: true })
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        ['/api/collections/work/move/', { parent: null, after: 'home' }],
      ]),
    )
  })
})

describe('Collections grid', () => {
  it('shows the top collections as cards, and remembers the choice', async () => {
    collections = [work, clients, home]
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: 'Grid' }))
    const grid = screen.getByRole('list', { name: 'Collections' })
    expect(within(grid).getByRole('link', { name: /Work/ })).toHaveTextContent(
      'Project · 2 items · 1 collection',
    )
    expect(within(grid).queryByRole('link', { name: /Clients/ })).toBeNull()
    expect(localStorage.getItem('brainbro:collections-view')).toBe('grid')
  })

  it('sorts the cards by dragging', async () => {
    localStorage.setItem('brainbro:collections-view', 'grid')
    collections = [work, home]
    renderPage()
    const grid = await screen.findByRole('list', { name: 'Collections' })
    const card = (name: string) =>
      within(grid).getByRole('link', { name: new RegExp(name) }).closest('li')!
    const dataTransfer = transfer()
    fireEvent.dragStart(card('Home'), { dataTransfer })
    fireEvent.dragOver(card('Work'), { dataTransfer })
    fireEvent.drop(card('Work'), { dataTransfer })
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        ['/api/collections/home/move/', { parent: null, after: null }],
      ]),
    )
  })
})
