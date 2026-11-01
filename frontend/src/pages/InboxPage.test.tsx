import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CaptureProvider } from '../capture/CaptureProvider'
import type { Item } from '../items/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { InboxPage } from './InboxPage'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function page(results: Item[]) {
  return { count: results.length, next: null, previous: null, results }
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

function renderInbox({ archived = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[archived ? '/archive' : '/']}>
        <FeedbackProvider>
          <CaptureProvider>
            <InboxPage archived={archived} />
          </CaptureProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('InboxPage', () => {
  it('lists archived items under the Archive tab', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse(
        page(url.includes('status=archived') ? [makeItem({ body: 'Old idea', status: 'archived' })] : []),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderInbox({ archived: true })

    expect(await screen.findByText('Old idea')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Archive' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'To inbox' })).toBeInTheDocument()
  })

  it('captures text on Enter and clears the box', async () => {
    let items: Item[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/items/capture/') {
        const { text } = JSON.parse(String(init?.body))
        const item = makeItem({ body: text })
        items = [item, ...items]
        return jsonResponse(item, 201)
      }
      return jsonResponse(page(items))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    const box = await screen.findByLabelText('Capture')
    fireEvent.change(box, { target: { value: '  Remember the milk  ' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Remember the milk')).toBeInTheDocument()
    expect(box).toHaveValue('')
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/items/capture/')!
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'Remember the milk' })
  })

  it('captures a paste outside the box right away', async () => {
    let items: Item[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/items/capture/') {
        const item = makeItem({ body: JSON.parse(String(init?.body)).text })
        items = [item, ...items]
        return jsonResponse(item, 201)
      }
      return jsonResponse(page(items))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()
    await screen.findByText(/Inbox zero/)

    const paste = new Event('paste', { bubbles: true }) as ClipboardEvent
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? '  Pasted idea ' : ''),
      },
    })
    document.body.dispatchEvent(paste)

    await waitFor(() => expect(screen.queryByLabelText('Capturing')).toBeNull())
    expect(await screen.findByText('Pasted idea')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Captured 1 item')
    expect(screen.getByLabelText('Capture')).toHaveValue('')
  })

  it('keeps Shift+Enter as a new line', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(page([])))
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    const box = await screen.findByLabelText('Capture')
    fireEvent.change(box, { target: { value: 'line one' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(fetchMock).not.toHaveBeenCalledWith('/api/items/capture/', expect.anything())
  })

  it('renders link previews and refreshes while they are pending', async () => {
    const pending = makeItem({
      kind: 'link',
      url: 'https://example.com/post',
      preview_status: 'pending',
    })
    const ready = {
      ...pending,
      title: 'A great post',
      preview_status: 'ready' as const,
      preview_image_url: `/api/items/${pending.id}/preview-image/?v=1.webp`,
      metadata: { description: 'Worth reading', site_name: 'Example' },
    }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        // Only the list counts: the filter asks for the apps once.
        url.startsWith('/api/items/?')
          ? jsonResponse(page([calls++ === 0 ? pending : ready]))
          : jsonResponse(page([])),
      ),
    )
    renderInbox()

    expect(await screen.findByText('Fetching preview…')).toBeInTheDocument()
    // Polls every 2s while a preview is pending.
    const link = await screen.findByRole('link', { name: 'A great post' }, { timeout: 4000 })
    expect(link).toHaveAttribute('href', 'https://example.com/post')
    expect(screen.getByText('Worth reading')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(document.querySelector('img[src*="preview-image"]')).not.toBeNull()

    const callsWhenReady = calls
    await new Promise((resolve) => setTimeout(resolve, 2500))
    expect(calls).toBe(callsWhenReady)
  }, 10000)

  it('offers a retry when the preview failed', async () => {
    const failed = makeItem({ kind: 'link', url: 'https://gone.example', preview_status: 'failed' })
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/refresh-preview/')
        ? jsonResponse({ ...failed, preview_status: 'pending' })
        : jsonResponse(page([failed])),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/items/${failed.id}/refresh-preview/`,
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('asks for the first item when nothing was ever captured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page([]))))
    renderInbox()
    expect(await screen.findByText(/Inbox zero/)).toBeInTheDocument()
    expect(screen.getByText(/Add your first item/)).toBeInTheDocument()
  })

  it('says everything is sorted when the items are elsewhere', async () => {
    const sorted = makeItem({ status: 'organized' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => jsonResponse(page(url.includes('status=inbox') ? [] : [sorted]))),
    )
    renderInbox()
    expect(await screen.findByText(/Everything is sorted/)).toBeInTheDocument()
  })

  it('lays items out as chosen, and remembers it', async () => {
    localStorage.clear()
    const items = [makeItem({ body: 'First' }), makeItem({ body: 'Second' })]
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(page(items))))
    const first = renderInbox()
    await screen.findAllByText('First')
    fireEvent.click(screen.getByRole('radio', { name: 'Grid' }))
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2)
    first.unmount()

    renderInbox()
    await screen.findAllByText('First')
    expect(screen.getByRole('radio', { name: 'Grid' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'List' }))
    expect(screen.getAllByRole('button', { name: /First|Second/ })).toHaveLength(2)
    localStorage.clear()
  })
})

describe('InboxPage origin filter', () => {
  it('marks what assistants did and filters by who made it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/items/apps/') return jsonResponse({ apps: ['Claude'] })
      const claude = makeItem({ body: 'From Claude', created_by: 'Claude', created_via: 'mcp' })
      const mine = makeItem({ body: 'Mine' })
      return jsonResponse(page(url.includes('app=Claude') ? [claude] : [claude, mine]))
    })
    vi.stubGlobal('fetch', fetchMock)
    renderInbox()

    await screen.findByText('Mine')
    expect(screen.getAllByText(/^Added by Claude/)).toHaveLength(2)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Made by' }), {
      target: { value: 'app:Claude' },
    })

    expect(await screen.findByText('From Claude')).toBeInTheDocument()
    expect(screen.queryByText('Mine')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('app=Claude'), expect.anything())
  })
})
