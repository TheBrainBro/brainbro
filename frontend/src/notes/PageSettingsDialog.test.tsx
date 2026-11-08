import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Item, PageSettings } from '../items/api'
import { PageSettingsDialog } from './PageSettingsDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const privateNote: Item = {
  id: 'n1',
  kind: 'note',
  status: 'inbox',
  title: '',
  body: '# Trip plan',
  url: '',
  metadata: {},
  preview_status: '',
  preview_image_url: null,
  file_url: null,
  collections: [],
  version: 'v1',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z',
  created_by: '',
  created_via: 'web',
  edited_by: '',
  edited_via: '',
  edited_at: null,
  public_slug: null,
  public_url: null,
  published_at: null,
}

const note: Item = {
  ...privateNote,
  public_slug: 'trip-plan',
  published_at: '2026-11-01T10:00:00Z',
  images: {
    'https://x.example/map.png': { status: 'ready', url: '/api/note-images/1/file/?v=a' },
    'https://x.example/sea.png': { status: 'ready', url: '/api/note-images/2/file/?v=b' },
  },
}

const page: PageSettings = {
  slug: 'trip-plan',
  address: '/@ana/',
  title: '',
  description: '',
  image: '',
  defaults: {
    title: 'Trip plan',
    description: 'Ten days in Japan.',
    image: 'https://x.example/map.png',
  },
  preview: { title: 'Trip plan', description: 'Ten days in Japan.', image_url: null },
}

function renderDialog(answer: (init: RequestInit) => Response, onClose = () => {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH' ? answer(init) : jsonResponse(page),
  )
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PageSettingsDialog note={note} onClose={onClose} />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('PageSettingsDialog', () => {
  it('shows the defaults and previews the shared link with them', async () => {
    renderDialog(() => jsonResponse(page))

    expect(await screen.findByLabelText('Title')).toHaveAttribute('placeholder', 'Trip plan')
    expect(screen.getByLabelText('Description')).toHaveAttribute(
      'placeholder',
      'Ten days in Japan.',
    )
    const preview = screen.getByLabelText('Link preview')
    expect(preview).toHaveTextContent('Trip plan')
    expect(preview).toHaveTextContent('Ten days in Japan.')
    expect(preview.querySelector('img')).toHaveAttribute('src', '/api/note-images/1/file/?v=a')
  })

  it('saves only what changed and closes', async () => {
    const onClose = vi.fn()
    const fetchMock = renderDialog(() => jsonResponse({ ...page, title: 'Japan' }), onClose)

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Japan' } })
    fireEvent.click(screen.getByRole('button', { name: 'No image' }))
    expect(within(screen.getByLabelText('Link preview')).queryByRole('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/page/',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Japan', image: 'none' }),
      }),
    )
  })

  it('says when the address is taken', async () => {
    renderDialog(() => jsonResponse({ slug: 'Another note already has this address.' }, 400))

    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'Plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another note already has this address.',
    )
  })
})
