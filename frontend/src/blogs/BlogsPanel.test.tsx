import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeedbackProvider } from '../ui/FeedbackProvider'
import type { Blog } from './api'
import { BlogsPanel } from './BlogsPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const blog: Blog = {
  id: 's1',
  hostname: 'blog.example.com',
  collection: 'c1',
  title: '',
  description: '',
  links: [],
  powered_by: true,
  status: 'unverified',
  checked_at: null,
  verified_at: null,
  url: 'https://blog.example.com/',
  records: [
    { type: 'CNAME', name: 'blog.example.com', value: 'brainbro.example.com' },
    {
      type: 'TXT',
      name: '_brainbro.blog.example.com',
      value: 'brainbro-site-verification=abc',
    },
  ],
  created_at: '2026-11-01T10:00:00Z',
}

const collections = [{ id: 'c1', name: 'Writing' }]

function renderPanel(blogs: Blog[], answers: Record<string, () => Response> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    if (answers[key]) return answers[key]()
    if (key === 'GET /api/sites/') return jsonResponse(blogs)
    if (url.startsWith('/api/collections/')) {
      return jsonResponse({ count: 1, next: null, previous: null, results: collections })
    }
    return jsonResponse({ detail: 'Not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <BlogsPanel />
      </FeedbackProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('BlogsPanel', () => {
  it('adds a blog on a domain, with its collection', async () => {
    const fetchMock = renderPanel([], { 'POST /api/sites/': () => jsonResponse(blog, 201) })

    fireEvent.change(await screen.findByLabelText('Domain'), {
      target: { value: 'blog.example.com' },
    })
    await screen.findByRole('option', { name: 'Writing' })
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add blog' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sites/',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ hostname: 'blog.example.com', collection: 'c1' }),
        }),
      ),
    )
  })

  it('says why a domain is refused', async () => {
    renderPanel([], {
      'POST /api/sites/': () =>
        jsonResponse({ hostname: ['Another blog already uses this domain.'] }, 400),
    })

    fireEvent.change(await screen.findByLabelText('Domain'), {
      target: { value: 'blog.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add blog' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another blog already uses this domain.',
    )
  })

  it('shows the DNS records of an unverified blog and verifies it', async () => {
    const fetchMock = renderPanel([blog], {
      'POST /api/sites/s1/verify/': () => jsonResponse({ ...blog, status: 'checking' }, 202),
    })

    const card = await screen.findByRole('region', { name: 'blog.example.com' })
    expect(within(card).getByText('Not verified')).toBeInTheDocument()
    expect(within(card).getByLabelText('TXT record value')).toHaveValue(
      'brainbro-site-verification=abc',
    )
    expect(within(card).getByLabelText('CNAME record value')).toHaveValue('brainbro.example.com')
    fireEvent.click(within(card).getByRole('button', { name: 'Verify' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sites/s1/verify/',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('links a verified blog and hides its records', async () => {
    renderPanel([{ ...blog, status: 'verified', verified_at: '2026-11-02T10:00:00Z' }])

    const card = await screen.findByRole('region', { name: 'blog.example.com' })
    expect(within(card).getByText('Verified')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open blog' })).toHaveAttribute(
      'href',
      'https://blog.example.com/',
    )
    expect(within(card).queryByLabelText('TXT record value')).not.toBeInTheDocument()
  })

  it('saves its links, leaving empty rows out', async () => {
    const fetchMock = renderPanel([blog], {
      'PATCH /api/sites/s1/': () => jsonResponse(blog),
    })

    const card = await screen.findByRole('region', { name: 'blog.example.com' })
    fireEvent.click(within(card).getByRole('button', { name: 'Add link' }))
    fireEvent.change(within(card).getByLabelText('Link 1 name'), { target: { value: 'Website' } })
    fireEvent.change(within(card).getByLabelText('Link 1 address'), {
      target: { value: 'https://carlos.dev' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Add link' }))
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sites/s1/',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            title: '',
            description: '',
            links: [{ name: 'Website', url: 'https://carlos.dev' }],
          }),
        }),
      ),
    )
  })

  it('turns "Powered by BrainBro" off', async () => {
    const fetchMock = renderPanel([blog], {
      'PATCH /api/sites/s1/': () => jsonResponse({ ...blog, powered_by: false }),
    })

    const card = await screen.findByRole('region', { name: 'blog.example.com' })
    fireEvent.click(within(card).getByRole('checkbox', { name: /Powered by BrainBro/ }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sites/s1/',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ powered_by: false }) }),
      ),
    )
  })

  it('deletes a blog after asking', async () => {
    const fetchMock = renderPanel([blog], {
      'DELETE /api/sites/s1/': () => new Response(null, { status: 204 }),
    })

    const card = await screen.findByRole('region', { name: 'blog.example.com' })
    fireEvent.click(within(card).getByRole('button', { name: 'Delete blog' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete the blog at blog.example.com?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete blog' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sites/s1/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
