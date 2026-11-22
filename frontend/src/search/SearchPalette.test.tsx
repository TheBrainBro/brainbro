import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { ContentMatch, Item, SearchResult } from '../items/api'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function item(id: string, fields: Partial<Item>): Item {
  return {
    id,
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
    edited_logo: '',
    created_logo: '',
    edited_at: null,
    public_slug: null,
    public_url: null,
    published_at: null,
    public_listed: true,
    ...fields,
  }
}

const note = item('n1', { body: '# Trip\n\nIdeas for the Paris trip' })
const archived = item('l1', {
  kind: 'link',
  status: 'archived',
  url: 'https://example.com/',
  metadata: { title: 'Old Paris guide' },
})
const images = [1, 2].map((i) =>
  item(`i${i}`, {
    kind: 'image',
    album: 'a1',
    file_url: `/file/i${i}`,
    metadata: { filename: `paris-${i}.jpg`, mime: 'image/jpeg' },
  }),
)
const album = item('a1', { kind: 'album', title: 'Holidays', album_items: images })

function match(text: string, at: Partial<ContentMatch> = {}): ContentMatch {
  return { text, page: null, start_seconds: null, end_seconds: null, ...at }
}

const contentResults: SearchResult[] = [
  {
    item: item('book', {
      kind: 'file', file_url: '/file/book', metadata: { mime: 'application/pdf', filename: 'Coasts.pdf' },
    }),
    album_image: null,
    matches: [match('Lighthouse map', { page: 2 }), match('Lighthouse diagram', { page: 9 })],
  },
  {
    item: item('interview', {
      kind: 'audio',
      file_url: '/file/interview',
      metadata: { mime: 'audio/wav', filename: 'Interview.wav', size: 50 * 1024 * 1024 },
    }),
    album_image: null,
    matches: [
      match('Lighthouse introduction', { start_seconds: 0, end_seconds: 2 }),
      match('Lighthouse interview', { start_seconds: 65.25, end_seconds: 69 }),
    ],
  },
  {
    item: album,
    album_image: 'i1',
    matches: [
      match('Lighthouse entrance', { album_image: 'i1' }),
      match('Lighthouse sign', { album_image: 'i2' }),
    ],
  },
  {
    item: item('schedule', {
      kind: 'file',
      file_url: '/file/schedule',
      metadata: { mime: 'text/plain', filename: 'Schedule.txt' },
    }),
    album_image: null,
    matches: [match('…The lighthouse opens at noon.')],
  },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/auth/session/')) {
      return jsonResponse({ authenticated: true, user: { id: 1, username: 'alex' } })
    }
    if (url.startsWith('/api/items/note-titles/')) return jsonResponse([])
    if (url === '/file/schedule') return new Response('Schedule\r\nFirst visit.\r\nThe lighthouse opens at noon.')
    if (url.startsWith('/api/items/search/')) {
      const q = new URLSearchParams(url.split('?')[1]).get('q')
      if (q === 'lighthouse') return jsonResponse(contentResults)
      return jsonResponse(
        q === 'paris'
          ? [
              { item: note, album_image: null },
              { item: archived, album_image: null },
              { item: album, album_image: 'i2' },
            ]
          : [],
      )
    }
    if (url.startsWith('/api/boards/')) {
      return jsonResponse({
        count: 2,
        results: [
          { id: 'b1', title: 'Paris plans' },
          { id: 'b2', title: 'Work' },
        ],
      })
    }
    if (url.startsWith('/api/collections/')) {
      return jsonResponse({ count: 1, results: [{ id: 'c1', name: 'Travel', icon: '' }] })
    }
    if (url.startsWith('/api/items/n1/')) return jsonResponse(note)
    return jsonResponse({ count: 0, next: null, previous: null, results: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/collections']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openPalette() {
  renderApp()
  await screen.findByRole('button', { name: 'Search' })
  // From anywhere, text fields included.
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  return screen.getByRole('combobox', { name: 'Search' })
}

async function searchFor(text: string) {
  const input = await openPalette()
  fireEvent.change(input, { target: { value: text } })
  await screen.findByRole('option', { name: /Ideas for the Paris trip/ })
  return input
}

describe('SearchPalette', () => {
  it('opens with Ctrl/Cmd+K or the top bar button, and closes with Esc', async () => {
    const input = await openPalette()
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument()
  })

  it('lists matching boards and items, with the matches marked', async () => {
    await searchFor('paris')
    const dialog = screen.getByRole('dialog', { name: 'Search' })
    const options = within(dialog).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Paris plans',
      'TripIdeas for the Paris trip',
      expect.stringContaining('Archived'),
      expect.stringContaining('paris-2.jpg'),
    ])
    expect(within(options[1]).getByText('Trip')).toBeInTheDocument()
    expect(within(options[1]).getByText('Paris', { selector: 'mark' })).toBeInTheDocument()
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(fetchMock).toHaveBeenCalledWith('/api/items/search/?q=paris', expect.anything())
  })

  it('says when nothing matches', async () => {
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument()
  })

  it('opens an item in the viewer, which steps through the results', async () => {
    const input = await searchFor('paris')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    const viewer = await screen.findByRole('dialog', { name: 'Trip' })
    expect(within(viewer).getByText(/1 of 3/)).toBeInTheDocument()
  })

  it('opens an album on the image that matched', async () => {
    const input = await searchFor('paris')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    const viewer = await screen.findByRole('dialog', { name: 'Holidays' })
    expect(within(viewer).getByText(/image 2 of 2/)).toBeInTheDocument()
  })

  it('opens each matching page and keeps its location through viewer navigation', async () => {
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = () => 'blob:book'
      static revokeObjectURL = () => {}
    })
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'lighthouse' } })
    const page = await screen.findByRole('option', { name: /Page 9.*diagram/ })
    expect(within(page).getByText('Lighthouse', { selector: 'mark' })).toBeInTheDocument()
    fireEvent.click(page)

    const viewer = await screen.findByRole('dialog', { name: 'Coasts.pdf' })
    expect(await within(viewer).findByTitle('Coasts.pdf')).toHaveAttribute('src', 'blob:book#page=9')
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    expect(within(viewer).getByTitle('Coasts.pdf')).toHaveAttribute('src', 'blob:book#page=2')
  })

  it('cues each spoken match, including one at the start of a recording', async () => {
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'lighthouse' } })
    await screen.findByRole('option', { name: /1:05.*interview/ })
    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    const viewer = await screen.findByRole('dialog', { name: 'Interview.wav' })
    const audio = viewer.querySelector('audio')!
    audio.play = vi.fn().mockResolvedValue(undefined)
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(65.25)
    expect(audio.play).toHaveBeenCalledOnce()
    audio.currentTime = 68
    fireEvent.loadedMetadata(audio)
    expect(audio.currentTime).toBe(68)

    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    const beginning = viewer.querySelector('audio')!
    beginning.play = vi.fn().mockResolvedValue(undefined)
    beginning.currentTime = 12
    fireEvent.loadedMetadata(beginning)
    expect(beginning.currentTime).toBe(0)
    expect(beginning.play).toHaveBeenCalledOnce()
  })

  it('opens the matching photo inside an album and the selected excerpt in a text file', async () => {
    const input = await openPalette()
    fireEvent.change(input, { target: { value: 'lighthouse' } })
    fireEvent.click(await screen.findByRole('option', { name: /Lighthouse sign/ }))
    const viewer = await screen.findByRole('dialog', { name: 'Holidays' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/file/i2')
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/file/i1')
    fireEvent.keyDown(viewer, { key: 'ArrowRight' })
    fireEvent.keyDown(viewer, { key: 'ArrowRight' })
    expect(await screen.findByText('The lighthouse opens at noon.', { selector: 'mark' })).toBeInTheDocument()
  })

  it('opens a note to edit with Ctrl/Cmd+Enter, and boards in place', async () => {
    let input = await searchFor('paris')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/items/n1/', expect.anything()),
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    input = screen.getByRole('combobox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'paris' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Paris plans' }))
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/boards/b1/', expect.anything()),
    )
  })
})
