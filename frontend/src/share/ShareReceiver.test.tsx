import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptureProvider } from '../capture/CaptureProvider'
import type { Item } from '../items/api'
import { InboxPage } from '../pages/InboxPage'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { deleteShare, listShares, saveShare, type Share } from './queue'
import { ShareReceiver } from './ShareReceiver'

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
    published_at: null,
    ...overrides,
  }
}

function share(overrides: Partial<Share>): Share {
  return { id: crypto.randomUUID(), createdAt: Date.now(), title: '', text: '', url: '', files: [], ...overrides }
}

let items: Item[]
let sent: string[]
let offline: boolean

beforeEach(async () => {
  items = []
  sent = []
  offline = false
  for (const queued of await listShares()) await deleteShare(queued.id)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/session/') {
        return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
      }
      if (url === '/api/items/capture/') {
        if (offline) throw new TypeError('Failed to fetch')
        const text = JSON.parse(String(init?.body)).text
        sent.push(text)
        const item = makeItem({ body: text })
        items = [item, ...items]
        return jsonResponse(item, 201)
      }
      return jsonResponse({ count: items.length, next: null, previous: null, results: items })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <CaptureProvider>
            <ShareReceiver />
            <InboxPage />
          </CaptureProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ShareReceiver', () => {
  it('sends queued shares through the capture pipeline, in order, and empties the queue', async () => {
    await saveShare(share({ createdAt: 2, text: 'second' }))
    await saveShare(share({ createdAt: 1, title: 'Page', url: 'https://example.com' }))
    renderInbox()

    expect(await screen.findByText('second')).toBeInTheDocument()
    expect(sent).toEqual(['https://example.com', 'second'])
    await waitFor(async () => expect(await listShares()).toEqual([]))
  })

  it('keeps a share that could not be sent, with no failed card, and sends it once back online', async () => {
    offline = true
    await saveShare(share({ text: 'shared offline' }))
    renderInbox()

    expect(await screen.findByText(/Kept 1 item on this device to send later/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await listShares()).toHaveLength(1)

    offline = false
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('shared offline')).toBeInTheDocument()
    await waitFor(async () => expect(await listShares()).toEqual([]))
  })

  it('waits for the network before trying', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await saveShare(share({ text: 'later' }))
    renderInbox()
    await screen.findByText(/Inbox zero/)
    expect(sent).toEqual([])

    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('later')).toBeInTheDocument()
    onLine.mockRestore()
  })
})
