import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes, SiteRoutes } from '../App'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const plan = {
  slug: 'trip-plan',
  handle: 'ana',
  title: 'Trip plan',
  body: '# Trip plan\n\nSee [[Packing]] and [[Diary]].\n\n![map](https://x.example/map.png)',
  published_at: '2026-10-01T10:00:00Z',
  edited_at: '2026-10-20T10:00:00Z',
  author: 'Carlos Lugones',
  images: {
    'https://x.example/map.png': {
      status: 'ready',
      url: '/api/public/notes/ana/trip-plan/images/1/?v=a',
    },
  },
  links: {},
  notes: [{ url: '/@ana/packing', title: 'Packing' }],
}

const packing = {
  ...plan,
  slug: 'packing',
  title: 'Packing',
  body: '# Packing\n\nSocks',
  author: '',
  notes: [],
}

const site = {
  hostname: 'blog.example.com',
  title: 'Ana writes',
  description: 'Notes on travel.',
  author: 'Ana',
  handle: 'ana',
  avatar_url: null,
  links: [{ name: 'Website', url: 'https://ana.dev' }],
  powered_by: true,
  categories: [{ slug: 'travel', name: 'Travel' }],
}

function renderAt(path: string, { onSite = false, poweredBy = true, note = plan } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/public/notes/ana/trip-plan/') return jsonResponse(note)
    if (url === '/api/public/notes/ana/packing/') return jsonResponse(packing)
    if (url === '/api/public/legacy/trip-plan/') return jsonResponse({ url: '/@ana/trip-plan' })
    if (url === '/api/public/site/' && onSite) {
      return jsonResponse({ ...site, powered_by: poweredBy })
    }
    if (url === '/api/public/authors/ana/') return jsonResponse({ handle: 'ana', author: 'Ana' })
    if (url.startsWith('/api/public/notes/?')) {
      return jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            slug: 'trip-plan',
            title: 'Trip plan',
            published_at: plan.published_at,
            url: onSite ? '/trip-plan' : '/@ana/trip-plan',
            excerpt: 'Ten days in Japan.',
            image_url: '/api/public/notes/ana/trip-plan/images/1/?v=a',
          },
        ],
      })
    }
    return jsonResponse({ detail: 'Not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        {onSite ? <SiteRoutes /> : <AppRoutes />}
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('PublicNotePage', () => {
  it('shows a published note without signing in', async () => {
    const fetchMock = renderAt('/@ana/trip-plan')

    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'map' })).toHaveAttribute(
      'src',
      '/api/public/notes/ana/trip-plan/images/1/?v=a',
    )
    expect(screen.getByText('Carlos Lugones')).toBeInTheDocument()
    expect(screen.getByText('October 1, 2026')).toBeInTheDocument()
    expect(screen.getByText('October 20, 2026')).toBeInTheDocument()
    // Never asks who is signed in.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/session/', expect.anything())
  })

  it('links published notes and leaves the rest as words', async () => {
    renderAt('/@ana/trip-plan')

    const packingLink = await screen.findByRole('link', { name: 'Packing' })
    expect(packingLink).toHaveAttribute('href', '/@ana/packing')
    expect(screen.queryByRole('link', { name: 'Diary' })).not.toBeInTheDocument()

    fireEvent.click(packingLink)

    expect(await screen.findByText('Socks')).toBeInTheDocument()
    // Without a display name, no author.
    expect(screen.queryByText(/^By /)).not.toBeInTheDocument()
  })

  it('says when the page is not there', async () => {
    renderAt('/@ana/gone')

    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })

  it('follows an address from before handles to where the note is now', async () => {
    renderAt('/p/trip-plan')

    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeInTheDocument()
  })

  it('says when an old address leads nowhere', async () => {
    renderAt('/p/gone')

    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })
})

describe('PublicIndexPage', () => {
  it('lists the published notes', async () => {
    renderAt('/p')

    expect(await screen.findByRole('link', { name: /Trip plan/ })).toHaveAttribute(
      'href',
      '/@ana/trip-plan',
    )
  })
})

describe('the article', () => {
  it("doesn't repeat a first heading that is its title", async () => {
    renderAt('/@ana/trip-plan')

    expect(await screen.findAllByRole('heading', { name: 'Trip plan' })).toHaveLength(1)
  })

  it("doesn't repeat a plain first line that is its title", async () => {
    renderAt('/@ana/trip-plan', { note: { ...plan, body: 'Trip plan\n\nTen days in Japan.' } })

    expect(await screen.findByText('Ten days in Japan.')).toBeInTheDocument()
    expect(screen.getAllByText('Trip plan')).toHaveLength(1)
  })

  it('keeps a first line that is not its title', async () => {
    renderAt('/@ana/trip-plan', { note: { ...plan, body: 'Before we go\n\nTen days.' } })

    expect(await screen.findByText(/Before we go/)).toBeInTheDocument()
  })

  it('shows each note in a list with the start of its text and its cover', async () => {
    renderAt('/@ana')

    const card = await screen.findByRole('link', { name: /Trip plan/ })
    expect(card).toHaveTextContent('Ten days in Japan.')
    expect(card.querySelector('img')).toHaveAttribute('src', '/api/public/notes/ana/trip-plan/images/1/?v=a')
  })
})

describe('more from the author', () => {
  it("isn't there when the note is their only one", async () => {
    renderAt('/@ana/trip-plan')

    expect(await screen.findByRole('link', { name: 'All posts' })).toHaveAttribute('href', '/@ana')
    expect(screen.queryByText(/More from/)).not.toBeInTheDocument()
  })

  it('shows their other notes', async () => {
    renderAt('/@ana/packing')

    expect(await screen.findByText('More from @ana')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Trip plan/ })).toHaveAttribute(
      'href',
      '/@ana/trip-plan',
    )
  })
})

describe('PublicAuthorPage', () => {
  it('shows an author with their public notes', async () => {
    const fetchMock = renderAt('/@ana')

    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByText('@ana')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Trip plan/ })).toHaveAttribute(
      'href',
      '/@ana/trip-plan',
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/public/notes/?limit=200&author=ana', expect.anything())
    // On the server's own domain, always.
    expect(screen.getByRole('link', { name: 'BrainBro' })).toBeInTheDocument()
  })

  it('says when there is no such author', async () => {
    renderAt('/@nobody')

    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })

  it('is reached from a note by its author', async () => {
    renderAt('/@ana/trip-plan')

    // The bar on top leads to their page.
    expect(await screen.findByRole('link', { name: /Carlos Lugones/ })).toHaveAttribute(
      'href',
      '/@ana',
    )
  })
})

describe('a blog on its own domain', () => {
  it('lists its notes under its name, at their short addresses', async () => {
    renderAt('/', { onSite: true })

    expect(await screen.findByRole('link', { name: 'Ana writes' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Notes on travel.')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Trip plan/ })).toHaveAttribute(
      'href',
      '/trip-plan',
    )
  })

  it('shows its links, and its categories as tabs', async () => {
    const fetchMock = renderAt('/c/travel', { onSite: true })

    expect(await screen.findByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://ana.dev',
    )
    const tabs = screen.getByRole('navigation', { name: 'Categories' })
    expect(within(tabs).getByRole('link', { name: 'All posts' })).toHaveAttribute('href', '/')
    expect(within(tabs).getByRole('link', { name: 'Travel' })).toHaveAttribute('aria-current', 'page')
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/public/notes/?limit=200&category=travel',
        expect.anything(),
      ),
    )
  })

  it('says it is powered by BrainBro, unless turned off', async () => {
    renderAt('/', { onSite: true })
    expect(await screen.findByRole('link', { name: 'BrainBro' })).toHaveAttribute(
      'href',
      'https://brainbro.app',
    )
  })

  it("doesn't when turned off", async () => {
    renderAt('/', { onSite: true, poweredBy: false })

    expect(await screen.findByRole('link', { name: 'Website' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'BrainBro' })).not.toBeInTheDocument()
  })

  it('shows a note at /<slug>', async () => {
    renderAt('/trip-plan', { onSite: true })

    expect(await screen.findByRole('heading', { name: 'Trip plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Feed' })).toHaveAttribute('href', '/rss')
  })
})
