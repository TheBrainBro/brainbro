import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from './App'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const user = { id: 1, username: 'carlos', email: '', is_staff: true }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth routing', () => {
  it('redirects anonymous users to the login page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ authenticated: false, user: null })))
    renderAt('/boards')
    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument()
  })

  it('shows the app to authenticated users', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ authenticated: true, user })))
    renderAt('/boards')
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument()
    expect(screen.getByText('carlos')).toBeInTheDocument()
  })

  it('logs in and sends the CSRF token', async () => {
    document.cookie = 'csrftoken=abc123'
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/login/')) return jsonResponse({ authenticated: true, user })
      if (url.includes('/items/')) return jsonResponse({ count: 0, next: null, previous: null, results: [] })
      return jsonResponse({ authenticated: false, user: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/')

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'carlos' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/login/'))! as unknown as [
      string,
      RequestInit,
    ]
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('abc123')
  })
})
