import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import type { Item } from '../items/api'

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
    edited_at: null,
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

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/auth/session/')) {
      return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
    }
    if (url.startsWith('/api/items/search/')) {
      const q = new URLSearchParams(url.split('?')[1]).get('q')
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
