import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '../items/api'
import { ItemList } from '../items/ItemList'
import { ViewerProvider } from './ViewerProvider'

function item(id: string, fields: Partial<Item>): Item {
  return {
    id,
    kind: 'image',
    status: 'inbox',
    title: '',
    body: '',
    url: '',
    metadata: {},
    preview_status: 'ready',
    preview_image_url: `/thumb/${id}.webp`,
    file_url: `/file/${id}`,
    collections: [],
    version: 'v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...fields,
  }
}

const items = [
  item('a', { metadata: { filename: 'beach.jpg', mime: 'image/jpeg', width: 800, height: 600 } }),
  item('b', { kind: 'file', metadata: { filename: 'notes.txt', mime: 'text/plain', size: 5 } }),
  item('c', {
    kind: 'link',
    url: 'https://example.com/',
    metadata: { title: 'Example', description: 'A page' },
  }),
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) =>
    url.startsWith('/file/') ? new Response('hello') : new Response('{}'),
  )
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ViewerProvider>
          <ItemList items={items} />
        </ViewerProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ItemViewer', () => {
  it('opens an image full size and steps through the list', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View beach.jpg' }))
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' })
    expect(within(viewer).getByRole('img', { name: 'beach.jpg' })).toHaveAttribute('src', '/file/a')
    expect(within(viewer).getByText(/1 of 3/)).toBeInTheDocument()

    fireEvent.keyDown(viewer, { key: 'ArrowRight' })
    // A text file is read and shown as it is.
    expect(await screen.findByText('hello')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    const link = screen.getByRole('dialog', { name: 'Example' })
    expect(within(link).getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      'https://example.com/',
    )
    expect(within(link).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()

    fireEvent.keyDown(link, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("keeps the page's shortcuts from seeing its keys", async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'notes.txt' }))
    const viewer = await screen.findByRole('dialog', { name: 'notes.txt' })
    // `e` archives in the list; in the viewer it does nothing.
    fireEvent.keyDown(viewer, { key: 'e' })
    const triaged = fetchMock.mock.calls.some(([url]) => String(url).includes('triage'))
    expect(triaged).toBe(false)
  })
})
