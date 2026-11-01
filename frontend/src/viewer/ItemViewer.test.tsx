import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '../items/api'
import { ItemList } from '../items/ItemList'
import { FeedbackProvider } from '../ui/FeedbackProvider'
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
    created_by: '',
    created_via: 'web',
    edited_by: '',
    edited_via: '',
    edited_at: null,
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

function renderList(list = items) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <FeedbackProvider>
          <ViewerProvider>
            <ItemList items={list} />
          </ViewerProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ItemViewer', () => {
  it('saves a caption under an image when leaving the field', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/items/a/' && init?.method === 'PATCH'
        ? new Response(JSON.stringify({ ...items[0], body: 'Our first trip', version: 'v2' }), {
            headers: { 'Content-Type': 'application/json' },
          })
        : new Response('{}'),
    )
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View beach.jpg' }))
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' })
    const caption = within(viewer).getByLabelText('Caption')

    fireEvent.change(caption, { target: { value: 'Our first trip' } })
    // Arrows move the cursor in the field, not to the next item.
    fireEvent.keyDown(caption, { key: 'ArrowRight' })
    expect(within(viewer).getByText(/1 of 3/)).toBeInTheDocument()
    fireEvent.blur(caption)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/a/',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ body: 'Our first trip' }) }),
      ),
    )
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/items/a/')!
    expect(new Headers((init as RequestInit).headers).get('If-Match')).toBe('"v1"')
    // Its caption names it now.
    expect(await screen.findByRole('dialog', { name: 'Our first trip' })).toBeInTheDocument()
  })

  it('renames a file by clicking its name in the bar', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/items/b/' && init?.method === 'PATCH'
        ? new Response(
            JSON.stringify({
              ...items[1],
              title: 'todo.txt',
              metadata: { ...items[1].metadata, filename: 'todo.txt' },
            }),
            { headers: { 'Content-Type': 'application/json' } },
          )
        : new Response('hello'),
    )
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View notes.txt' }))
    const viewer = await screen.findByRole('dialog', { name: 'notes.txt' })

    const field = within(viewer).getByLabelText('Name')
    expect(field).toHaveValue('notes.txt')
    fireEvent.change(field, { target: { value: 'todo' } })
    fireEvent.blur(field)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/b/',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ filename: 'todo' }) }),
      ),
    )
    expect(await screen.findByRole('dialog', { name: 'todo.txt' })).toBeInTheDocument()
  })

  it('leaves the name as it was on Esc', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View notes.txt' }))
    const viewer = await screen.findByRole('dialog', { name: 'notes.txt' })
    const field = within(viewer).getByLabelText('Name')
    field.focus()
    fireEvent.change(field, { target: { value: 'other' } })
    fireEvent.keyDown(field, { key: 'Escape' })

    await waitFor(() => expect(field).toHaveValue('notes.txt'))
    expect(screen.getByRole('dialog', { name: 'notes.txt' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/items/b/', expect.anything())
  })

  it('archives the item shown and stays open on it, with undo', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url !== '/api/items/triage/') return new Response('{}')
      const { action } = JSON.parse(String(init?.body))
      const status = action === 'archive' ? 'archived' : 'inbox'
      return new Response(JSON.stringify([{ ...items[0], status }]), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View beach.jpg' }))
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' })
    fireEvent.click(within(viewer).getByRole('button', { name: 'Archive' }))

    expect(await within(viewer).findByRole('button', { name: 'To inbox' })).toBeInTheDocument()
    const toast = await screen.findByRole('status')
    expect(toast).toHaveTextContent('Archived 1 item')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/triage/',
        expect.objectContaining({ body: JSON.stringify({ ids: ['a'], action: 'inbox' }) }),
      ),
    )
  })

  it('organizes the item shown from its menu', async () => {
    const work = {
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
    }
    fetchMock.mockImplementation(async (url: string) => {
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
      if (url.startsWith('/api/collections/')) {
        return json({ count: 1, next: null, previous: null, results: [work] })
      }
      if (url === '/api/items/triage/') {
        return json([{ ...items[0], status: 'organized', collections: ['work'] }])
      }
      return new Response('{}')
    })
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View beach.jpg' }))
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' })
    fireEvent.click(within(viewer).getByRole('button', { name: 'Organize' }))
    const menu = await screen.findByRole('menu', { name: 'Organize into' })
    fireEvent.click(await within(menu).findByRole('menuitem', { name: /Work/ }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/triage/',
        expect.objectContaining({
          body: JSON.stringify({ ids: ['a'], action: 'organize', collections: ['work'] }),
        }),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Organized 1 item into Work')
    expect(screen.getByRole('dialog', { name: 'beach.jpg' })).toBeInTheDocument()
  })

  it('deletes the item shown, after asking, and closes', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'View beach.jpg' }))
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' })
    fireEvent.click(within(viewer).getByRole('button', { name: 'Delete' }))

    const confirm = await screen.findByRole('alertdialog', { name: 'Delete this item?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/triage/',
        expect.objectContaining({ body: JSON.stringify({ ids: ['a'], action: 'delete' }) }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted 1 item')
  })

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

  it('plays a recording, which can be renamed and captioned', async () => {
    const recording = item('v', {
      kind: 'audio',
      title: 'Voice note.webm',
      preview_image_url: null,
      metadata: { filename: 'Voice note.webm', mime: 'audio/webm', size: 2048 },
    })
    renderList([recording])
    fireEvent.click(screen.getByRole('button', { name: 'Voice note.webm' }))
    const viewer = await screen.findByRole('dialog', { name: 'Voice note.webm' })

    expect(viewer.querySelector('audio')).toHaveAttribute('src', '/file/v')
    expect(within(viewer).getByLabelText('Name')).toHaveValue('Voice note.webm')
    expect(within(viewer).getByLabelText('Caption')).toBeInTheDocument()
    expect(within(viewer).getByText('2 KB · audio/webm')).toBeInTheDocument()
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
