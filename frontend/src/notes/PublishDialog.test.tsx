import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useItem, type Item } from '../items/api'
import { PublishDialog } from './PublishDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const draft: Item = {
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
  published_at: null,
}

const published = { ...draft, public_slug: 'trip-plan', published_at: '2026-11-01T10:00:00Z' }

/** The dialog over the cached note, as the note page shows it. */
function Harness() {
  const note = useItem('n1').data
  return note ? <PublishDialog note={note} onClose={() => {}} /> : null
}

function renderDialog(initial: Item, answer: (init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method && init.method !== 'GET' ? answer(init) : jsonResponse(initial),
  )
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('PublishDialog', () => {
  it('publishes the note and shows its link', async () => {
    const fetchMock = renderDialog(draft, () => jsonResponse(published))

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))

    expect(await screen.findByRole('heading', { name: 'This note is public' })).toBeInTheDocument()
    expect(screen.getByLabelText('Public link')).toHaveValue(`${window.location.origin}/p/trip-plan`)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/publication/',
      expect.objectContaining({ method: 'PUT', body: '{}' }),
    )
  })

  it('changes the address', async () => {
    const fetchMock = renderDialog(published, () =>
      jsonResponse({ ...published, public_slug: 'japan' }),
    )

    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'Japan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByDisplayValue(`${window.location.origin}/p/japan`)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/publication/',
      expect.objectContaining({ method: 'PUT', body: '{"slug":"japan"}' }),
    )
  })

  it('says when the address is taken', async () => {
    renderDialog(published, () =>
      jsonResponse({ slug: 'Another note already has this address.' }, 400),
    )

    fireEvent.change(await screen.findByLabelText('Address'), { target: { value: 'plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another note already has this address.',
    )
  })

  it('takes the note down', async () => {
    const fetchMock = renderDialog(published, () => jsonResponse({ ...published, published_at: null }))

    fireEvent.click(await screen.findByRole('button', { name: 'Unpublish' }))

    expect(await screen.findByRole('heading', { name: 'Publish this note' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/n1/publication/',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
