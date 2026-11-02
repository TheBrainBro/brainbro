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

const QUERY = 'response_type=code&client_id=c1&state=xyz'

function renderAt(path: string, { authenticated = true, known = true } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse(
        authenticated
          ? { authenticated: true, user: { id: 1, username: 'carlos' }, welcome_seen: true }
          : { authenticated: false, user: null },
      )
    }
    if (url.startsWith('/api/auth/oauth/authorize/')) {
      if (init?.method === 'POST') {
        return jsonResponse({ redirect_to: 'https://chatgpt.com/callback?code=abc&state=xyz' })
      }
      return known
        ? jsonResponse({ client_name: 'ChatGPT', redirect_host: 'chatgpt.com' })
        : jsonResponse({ non_field_errors: ["This app isn't registered with BrainBro."] }, 400)
    }
    return jsonResponse({})
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

describe('AuthorizePage', () => {
  it('asks to connect the app, saying where it goes back to', async () => {
    const fetchMock = renderAt(`/oauth/authorize?${QUERY}`)

    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT?' })).toBeInTheDocument()
    expect(screen.getByText('chatgpt.com')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(`/api/auth/oauth/authorize/?${QUERY}`, expect.anything())
  })

  it('sends the browser back to the app with the answer', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    const fetchMock = renderAt(`/oauth/authorize?${QUERY}`)

    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://chatgpt.com/callback?code=abc&state=xyz'),
    )
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      response_type: 'code',
      client_id: 'c1',
      state: 'xyz',
      allow: true,
    })
  })

  it('says when the app is unknown', async () => {
    renderAt(`/oauth/authorize?${QUERY}`, { known: false })
    expect(await screen.findByRole('alert')).toHaveTextContent("This app isn't registered")
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })

  it('asks to sign in first, and comes back with the query', async () => {
    renderAt(`/oauth/authorize?${QUERY}`, { authenticated: false })
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})
