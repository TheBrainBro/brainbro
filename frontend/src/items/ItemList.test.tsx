import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FeedbackProvider } from '../ui/FeedbackProvider'
import { ItemList } from './ItemList'
import type { Collection, Item } from './api'
import type { ViewMode } from './viewMode'

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
      image_url: null,
      parent: null,
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

function renderList(mode?: ViewMode, sortable?: { collection?: string }, list = items) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <ItemList items={list} mode={mode} sortable={sortable} />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function card(text: string) {
  return screen.getByText(text).closest('article') as HTMLElement
}

describe('ItemList triage', () => {
  it('animates items added after the first list render', () => {
    const view = renderList(undefined, undefined, [items[0]])

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FeedbackProvider>
            <ItemList items={[items[0], items[1]]} />
          </FeedbackProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Second').closest('li')).toHaveClass('item-entering')
  })

  it('keeps removed items visible while their exit animation runs', () => {
    const view = renderList(undefined, undefined, [items[0], items[1]])

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FeedbackProvider>
            <ItemList items={[items[0]]} />
          </FeedbackProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const exiting = screen.getByText('Second').closest('li') as HTMLElement
    expect(exiting).toHaveClass('item-departing')
    expect(exiting).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows card actions as icons in narrow masonry columns', () => {
    renderList('masonry')
    const archive = within(card('Second')).getByRole('button', { name: 'Archive' })
    expect(archive).toHaveAttribute('aria-label', 'Archive')
  })

  it('archives a single item from its card', async () => {
    renderList()
    fireEvent.click(within(card('Second')).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(triageCalls()).toEqual([{ ids: ['b'], action: 'archive' }]))
  })

  it('says what it archived and puts it back on Undo', async () => {
    renderList()
    fireEvent.click(within(card('Second')).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Archived 1 item')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(triageCalls()).toEqual([
        { ids: ['b'], action: 'archive' },
        { ids: ['b'], action: 'inbox' },
      ]),
    )
  })

  it('shows a failed triage as an error toast', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ detail: 'Server is down.' }, 500))
    renderList()
    fireEvent.click(within(card('Second')).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server is down.')
  })

  it('bulk deletes the selection after confirming', async () => {
    renderList()
    fireEvent.click(within(card('First')).getByRole('checkbox', { name: 'Select' }))
    fireEvent.click(within(card('Third')).getByRole('checkbox', { name: 'Select' }))

    const toolbar = screen.getByRole('toolbar', { name: 'Selection' })
    expect(toolbar).toHaveTextContent('2 selected')
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete 2 items?' })
    expect(triageCalls()).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(triageCalls()).toEqual([{ ids: ['a', 'c'], action: 'delete' }]))
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 2 items')
  })

  it('does not delete when the confirmation is cancelled', async () => {
    renderList()
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this item?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
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

  it('organizes in one click from the menu that opens on hover', async () => {
    renderList()
    const organize = within(card('First')).getByRole('button', { name: 'Organize' })
    fireEvent.pointerEnter(organize, { pointerType: 'mouse' })

    const menu = await screen.findByRole('menu', { name: 'Organize into' })
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Work/ }))
    await waitFor(() =>
      expect(triageCalls()).toEqual([{ ids: ['a'], action: 'organize', collections: ['work'] }]),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Organized 1 item into Work')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('takes an item out of a ticked collection, with undo', async () => {
    renderList(undefined, undefined, [{ ...items[0], status: 'organized', collections: ['work'] }])
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Organize' }))

    const menu = await screen.findByRole('menu', { name: 'Organize into' })
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Work/ }))
    await waitFor(() =>
      expect(triageCalls()).toEqual([{ ids: ['a'], action: 'unorganize', collections: ['work'] }]),
    )
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Took 1 item out of Work')

    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(triageCalls()[1]).toEqual({ ids: ['a'], action: 'organize', collections: ['work'] }),
    )
  })

  it('creates a collection from the menu and organizes into it', async () => {
    renderList()
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Organize' }))

    const menu = await screen.findByRole('menu', { name: 'Organize into' })
    const input = within(menu).getByLabelText('Find or create a collection')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'Reading' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(triageCalls()).toEqual([{ ids: ['a'], action: 'organize', collections: ['new'] }]),
    )
  })

  it('organizes into an existing and a newly created collection', async () => {
    renderList()
    fireEvent.click(within(card('First')).getByRole('button', { name: 'Organize' }))
    const menu = await screen.findByRole('menu', { name: 'Organize into' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Several collections…' }))

    const dialog = await screen.findByRole('dialog', { name: 'Organize into collections' })
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Work/ }))

    const input = within(dialog).getByLabelText('Find or create a collection')
    fireEvent.change(input, { target: { value: 'Reading' } })
    expect(within(dialog).getByText('Enter to create “Reading”')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(''))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Organize' }))
    await waitFor(() =>
      expect(triageCalls()).toEqual([
        { ids: ['a'], action: 'organize', collections: ['work', 'new'] },
      ]),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

function moveCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/move/'))
    .map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))])
}

describe('ItemList sorting', () => {
  const transfer = () => ({ effectAllowed: '', dropEffect: '', setData: () => {} })

  it('makes way while dragging, and drops the item where it is shown', async () => {
    renderList('cards', {})
    const first = card('First').closest('li')!
    const dataTransfer = transfer()
    fireEvent.dragStart(first, { dataTransfer })
    // Over Third: the dragged item takes its place, the others move up.
    fireEvent.dragOver(card('Third').closest('li')!, { dataTransfer })
    const order = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(order.map((text) => text?.match(/First|Second|Third/)?.[0])).toEqual([
      'Second',
      'Third',
      'First',
    ])
    fireEvent.drop(card('First').closest('li')!, { dataTransfer })
    fireEvent.dragEnd(first, { dataTransfer })

    await waitFor(() => expect(moveCalls()).toEqual([['/api/items/a/move/', { after: 'c' }]]))
  })

  it('shows a grab cursor only on hand-sorted lists', () => {
    renderList('cards', {})
    expect(card('First').closest('li')).toHaveClass('cursor-grab')
  })

  it('moves the focused item with Alt+arrows, within its collection', async () => {
    renderList('cards', { collection: 'work' })
    fireEvent.mouseDown(card('Second'))
    fireEvent.keyDown(window, { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true })
    await waitFor(() =>
      expect(moveCalls()).toEqual([
        ['/api/items/b/move/', { after: null, collection: 'work' }],
        ['/api/items/b/move/', { after: 'c', collection: 'work' }],
      ]),
    )
  })

  it("isn't draggable outside a hand-sorted list", () => {
    renderList()
    expect(card('First').closest('li')).toHaveAttribute('draggable', 'false')
  })
})

describe('ItemList archived', () => {
  it('offers To inbox instead of Archive', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <FeedbackProvider>
            <ItemList items={items} archived />
          </FeedbackProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const actions = within(card('First'))
    expect(actions.getByRole('button', { name: 'To inbox' })).toBeInTheDocument()
    expect(actions.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
  })
})

describe('ItemList tasks', () => {
  it('keeps a task box mounted through the focus re-render, so the click lands', async () => {
    const tasks = note('t', '- [ ] one\n- [ ] two')
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <FeedbackProvider>
            <ItemList items={[tasks]} />
          </FeedbackProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const [box] = screen.getAllByRole('checkbox', { name: 'To do' })
    // Pressing focuses the card (a re-render) before the click arrives.
    fireEvent.mouseDown(box)
    expect(box.isConnected).toBe(true)
    fireEvent.click(box)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/t/',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/items/t/')!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ body: '- [x] one\n- [ ] two' })
  })
})
