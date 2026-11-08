import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useItem, type Item } from '../items/api'
import { VisibilityMenu } from './VisibilityMenu'

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

const publicNote = {
  ...privateNote,
  public_slug: 'trip-plan',
  public_url: '/@ana/trip-plan',
  published_at: '2026-11-01T10:00:00Z',
}

/** The menu over the cached note, as the note page shows it. */
function Harness({ onSettings }: { onSettings: () => void }) {
  const note = useItem('n1').data
  return note ? <VisibilityMenu note={note} onSettings={onSettings} /> : null
}

function renderMenu(initial: Item, answer: () => Response, onSettings = () => {}) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method && init.method !== 'GET' ? answer() : jsonResponse(initial),
  )
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness onSettings={onSettings} />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('VisibilityMenu', () => {
  it('is private by default, and choosing public publishes the note at once', async () => {
    const fetchMock = renderMenu(privateNote, () => jsonResponse(publicNote))

    fireEvent.click(await screen.findByRole('button', { name: 'Visibility: private' }))
    expect(screen.getByRole('button', { name: /Private/, pressed: true })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Public/, pressed: false }))

    expect(await screen.findByLabelText('Public link')).toHaveValue(
      `${window.location.origin}/@ana/trip-plan`,
    )
    expect(screen.getByRole('button', { name: 'Visibility: public' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/publication/',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('makes a public note private again', async () => {
    const fetchMock = renderMenu(publicNote, () => jsonResponse(privateNote))

    fireEvent.click(await screen.findByRole('button', { name: 'Visibility: public' }))
    fireEvent.click(screen.getByRole('button', { name: /Private/, pressed: false }))

    expect(await screen.findByRole('button', { name: 'Visibility: private' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Public link')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/publication/',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('opens the page settings of a public note', async () => {
    const onSettings = vi.fn()
    renderMenu(publicNote, () => jsonResponse(publicNote), onSettings)

    fireEvent.click(await screen.findByRole('button', { name: 'Visibility: public' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page settings…' }))

    expect(onSettings).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Visibility' })).not.toBeInTheDocument()
  })
})
