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

// Signed in, with no notes to link to.
const signedIn = async (url: string) =>
  jsonResponse(
    url.includes('/auth/session/')
      ? { authenticated: true, user }
      : url.includes('/items/note-titles/')
        ? []
        : { count: 0, results: [], next: null },
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth routing', () => {
  it('redirects anonymous users to the login page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ authenticated: false, user: null })))
    renderAt('/boards')
    expect(await screen.findByText('Sign in to your second brain')).toBeInTheDocument()
  })

  it('shows the app to authenticated users', async () => {
    vi.stubGlobal('fetch', vi.fn(signedIn))
    renderAt('/boards')
    expect(await screen.findByRole('heading', { name: 'Boards' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByRole('menu')).toHaveTextContent('carlos')
  })

  it('says it is offline, not broken, when the session cannot be fetched without network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: "You're offline" })).toBeInTheDocument()
    expect(screen.getByText(/Anything you share is kept on this device/)).toBeInTheDocument()
    onLine.mockRestore()
  })

  it('opens the keyboard shortcuts with ? or from the account menu, not while typing', async () => {
    vi.stubGlobal('fetch', vi.fn(signedIn))
    renderAt('/')
    const input = await screen.findByRole('textbox', { name: 'Capture' })

    fireEvent.keyDown(input, { key: '?' })
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()

    fireEvent.keyDown(window, { key: '?' })
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(dialog).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  })

  it('opens the settings from the account menu', async () => {
    vi.stubGlobal('fetch', vi.fn(signedIn))
    renderAt('/boards')

    fireEvent.click(await screen.findByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('goes back to the login page after signing out', async () => {
    let signedIn = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/items/note-titles/')) return jsonResponse([])
        if (url.endsWith('/auth/logout/')) {
          signedIn = false
          return new Response(null, { status: 204 })
        }
        return jsonResponse(signedIn ? { authenticated: true, user } : { authenticated: false, user: null })
      }),
    )
    renderAt('/boards')
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('Sign in to your second brain')).toBeInTheDocument()
  })

  it('logs in and sends the CSRF token', async () => {
    document.cookie = 'csrftoken=abc123'
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/login/')) return jsonResponse({ authenticated: true, user })
      if (url.includes('/items/note-titles/')) return jsonResponse([])
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
