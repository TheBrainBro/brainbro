import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { boardKey, type Board } from '../boards/api'
import { emptyLayout } from '../boards/layout'
import type { Item } from '../items/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import type { RevisionDetail } from './api'
import { BoardHistory, NoteHistory } from './HistoryPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function revision(id: string, fields: Partial<RevisionDetail>): RevisionDetail {
  return {
    id,
    item: null,
    board: null,
    title: '',
    by: '',
    via: 'web',
    restored_from: null,
    restored_from_at: null,
    created_at: minutesAgo(10),
    updated_at: minutesAgo(10),
    body: '',
    layout: null,
    items: null,
    ...fields,
  }
}

const note: Item = {
  id: 'n1',
  kind: 'note',
  status: 'inbox',
  title: 'Plan',
  body: 'Buy flights\nBook the hotel\n',
  url: '',
  metadata: {},
  preview_status: '',
  preview_image_url: null,
  file_url: null,
  collections: [],
  version: 'v2',
  created_at: minutesAgo(60),
  updated_at: minutesAgo(1),
  created_by: '',
  created_via: 'web',
  edited_by: 'Claude',
  edited_via: 'mcp',
  edited_at: minutesAgo(1),
  public_slug: null,
  published_at: null,
}

let revisions: RevisionDetail[]
let restored: string[]

beforeEach(() => {
  restored = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/revisions/?')) {
        const results = revisions.map(({ body: _b, layout: _l, items: _i, ...rest }) => rest)
        return jsonResponse({ count: results.length, next: null, results })
      }
      const restore = url.match(/^\/api\/revisions\/(\w+)\/restore\/$/)
      if (restore && init?.method === 'POST') {
        restored.push(restore[1])
        const old = revisions.find((entry) => entry.id === restore[1])!
        if (old.item) return jsonResponse({ ...note, body: old.body, version: 'v3' })
        return jsonResponse({ ...board, title: old.title, layout: old.layout, revision: 6 })
      }
      const detail = url.match(/^\/api\/revisions\/(\w+)\/$/)
      if (detail) return jsonResponse(revisions.find((entry) => entry.id === detail[1]))
      return jsonResponse({ detail: 'Not found' }, 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function renderWith(queryClient: QueryClient, children: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>{children}</FeedbackProvider>
    </QueryClientProvider>,
  )
}

async function confirmRestore() {
  fireEvent.click(await screen.findByRole('button', { name: 'Restore this version' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
}

describe('NoteHistory', () => {
  beforeEach(() => {
    revisions = [
      revision('r2', { item: 'n1', title: 'Plan', body: note.body, by: 'Claude', via: 'mcp', updated_at: minutesAgo(1) }),
      revision('r1', { item: 'n1', title: 'Plan', body: 'Buy flights\n' }),
    ]
  })

  it('lists who saved each version and shows what changed since the one before', async () => {
    renderWith(new QueryClient(), <NoteHistory note={note} onRestored={() => {}} onClose={() => {}} />)

    const list = await screen.findByRole('list', { name: 'Revisions' })
    const entries = within(list).getAllByRole('button')
    expect(entries[0]).toHaveTextContent('Claude')
    expect(entries[0]).toHaveTextContent('Current version')
    expect(entries[1]).toHaveTextContent('You')
    // The one before the current is picked first.
    expect(entries[1]).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByLabelText('Changes')).toHaveTextContent('added: Book the hotel')
  })

  it('restores the version picked, after asking', async () => {
    const onRestored = vi.fn()
    renderWith(new QueryClient(), <NoteHistory note={note} onRestored={onRestored} onClose={() => {}} />)

    await confirmRestore()

    await waitFor(() => expect(onRestored).toHaveBeenCalled())
    expect(restored).toEqual(['r1'])
    expect(onRestored.mock.calls[0][0].body).toBe('Buy flights\n')
  })

  it('shows a version as it was', async () => {
    renderWith(new QueryClient(), <NoteHistory note={note} onRestored={() => {}} onClose={() => {}} />)

    fireEvent.click(await screen.findByRole('tab', { name: 'As it was' }))

    expect(await screen.findByText('Buy flights', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText(/Book the hotel/)).not.toBeInTheDocument()
  })

  it('explains that edits will appear here when the note only has one version', async () => {
    revisions = [revision('r1', { item: 'n1', title: 'Plan', body: note.body })]

    renderWith(new QueryClient(), <NoteHistory note={note} onRestored={() => {}} onClose={() => {}} />)

    expect(await screen.findByRole('heading', { name: 'No changes yet, bro' })).toBeInTheDocument()
    expect(screen.getByText('Every edit will show up here, and you can bring back any version.')).toBeInTheDocument()
    expect(screen.queryByText('This is what the note holds now.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'As it was' }))
    expect(await screen.findByText(/Buy flights/, { selector: 'p' })).toHaveTextContent('Book the hotel')
  })
})

const placed: Item = { ...note, id: 'i1', title: 'Hotels' }
const board: Board = {
  id: 'b1',
  title: 'Japan',
  item_count: 0,
  revision: 5,
  created_at: minutesAgo(60),
  updated_at: minutesAgo(1),
  layout: emptyLayout(),
  items: [],
}

describe('BoardHistory', () => {
  beforeEach(() => {
    const before = {
      ...emptyLayout(),
      nodes: [
        { id: 'a', type: 'item' as const, item: 'i1', x: 0, y: 0, w: null, h: null, parent: null },
      ],
    }
    revisions = [
      revision('r2', { board: 'b1', title: 'Japan', layout: emptyLayout(), items: [] }),
      revision('r1', { board: 'b1', title: 'Trip', layout: before, items: [placed] }),
    ]
  })

  it('says what changed on the board and restores it', async () => {
    const queryClient = new QueryClient()
    renderWith(queryClient, <BoardHistory board={board} onClose={() => {}} />)

    const changes = await screen.findByRole('region', { name: 'Changes since this version' })
    await waitFor(() => expect(changes).toHaveTextContent('Removed “Hotels”'))
    expect(changes).toHaveTextContent('Renamed from “Trip”')

    await confirmRestore()

    await waitFor(() => expect(restored).toEqual(['r1']))
    await waitFor(() =>
      expect(queryClient.getQueryData<Board>(boardKey('b1'))?.title).toBe('Trip'),
    )
  })
})
