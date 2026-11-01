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

let captured: unknown[]

function renderAt(path: string) {
  captured = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/session/') {
        return jsonResponse({ authenticated: true, user: { id: 1, username: 'carlos' } })
      }
      if (url === '/api/items/note-titles/') return jsonResponse([])
      if (url === '/api/items/capture/') {
        captured.push(JSON.parse(String(init?.body)))
        return jsonResponse({ id: 'i1', kind: 'link', url: 'https://example.com' }, 201)
      }
      return jsonResponse({ count: 0, next: null, previous: null, results: [] })
    }),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SharePage', () => {
  it('asks before saving a share that came as a link, then captures it', async () => {
    renderAt('/share?title=Example&url=https%3A%2F%2Fexample.com')
    expect(await screen.findByText('Save to the inbox?')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
    expect(captured).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    await vi.waitFor(() => expect(captured).toEqual([{ text: 'https://example.com' }]))
  })

  it('says when a share reached the server instead of the app', async () => {
    renderAt('/share?lost=1')
    expect(await screen.findByText("That share didn't arrive")).toBeInTheDocument()
  })

  it('goes to the inbox when there is nothing to save', async () => {
    renderAt('/share')
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
  })
})

describe('CapturePage', () => {
  it('saves the text and goes back to the inbox', async () => {
    renderAt('/capture')
    fireEvent.change(await screen.findByLabelText('Text or link'), {
      target: { value: 'a thought' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    await vi.waitFor(() => expect(captured).toEqual([{ text: 'a thought' }]))
  })
})
