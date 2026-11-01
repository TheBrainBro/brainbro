import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const plan = {
  slug: 'trip-plan',
  title: 'Trip plan',
  body: '# Trip plan\n\nSee [[Packing]] and [[Diary]].\n\n![map](https://x.example/map.png)',
  published_at: '2026-10-01T10:00:00Z',
  edited_at: '2026-10-20T10:00:00Z',
  author: 'Carlos Lugones',
  images: {
    'https://x.example/map.png': {
      status: 'ready',
      url: '/api/public/notes/trip-plan/images/1/?v=a',
    },
  },
  links: {},
  notes: [{ slug: 'packing', title: 'Packing' }],
}

const packing = {
  ...plan,
  slug: 'packing',
  title: 'Packing',
  body: '# Packing\n\nSocks',
  author: '',
  notes: [],
}

function renderAt(path: string) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/public/notes/trip-plan/') return jsonResponse(plan)
    if (url === '/api/public/notes/packing/') return jsonResponse(packing)
    if (url.startsWith('/api/public/notes/?')) {
      return jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ slug: 'trip-plan', title: 'Trip plan', published_at: plan.published_at }],
      })
    }
    return jsonResponse({ detail: 'Not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('PublicNotePage', () => {
  it('shows a published note without signing in', async () => {
    const fetchMock = renderAt('/p/trip-plan')

    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'map' })).toHaveAttribute(
      'src',
      '/api/public/notes/trip-plan/images/1/?v=a',
    )
    expect(screen.getByText('Carlos Lugones')).toBeInTheDocument()
    expect(screen.getByText('October 1, 2026')).toBeInTheDocument()
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument()
    // Never asks who is signed in.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/session/', expect.anything())
  })

  it('links published notes and leaves the rest as words', async () => {
    renderAt('/p/trip-plan')

    const packingLink = await screen.findByRole('link', { name: 'Packing' })
    expect(packingLink).toHaveAttribute('href', '/p/packing')
    expect(screen.queryByRole('link', { name: 'Diary' })).not.toBeInTheDocument()

    fireEvent.click(packingLink)

    expect(await screen.findByText('Socks')).toBeInTheDocument()
    // Without a display name, no author.
    expect(screen.queryByText(/^By /)).not.toBeInTheDocument()
  })

  it('says when the page is not there', async () => {
    renderAt('/p/gone')

    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })
})

describe('PublicIndexPage', () => {
  it('lists the published notes', async () => {
    renderAt('/p')

    expect(await screen.findByRole('link', { name: /Trip plan/ })).toHaveAttribute(
      'href',
      '/p/trip-plan',
    )
  })
})
