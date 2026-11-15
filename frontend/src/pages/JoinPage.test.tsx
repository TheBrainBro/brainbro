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

const signedIn = { authenticated: true, user: { id: 2, username: 'ana' }, welcome_seen: true }

function renderAt(
  path: string,
  {
    authenticated = false,
    valid = true,
    joined = jsonResponse(signedIn, 201),
    emailEnabled = false,
  } = {},
) {
  let session: object = authenticated ? signedIn : { authenticated: false, user: null, email_enabled: emailEnabled }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') return jsonResponse(session)
    if (url === '/api/auth/logout/') {
      session = { authenticated: false, user: null }
      return new Response(null, { status: 204 })
    }
    if (url.startsWith('/api/auth/join/')) {
      if (init?.method === 'POST') return joined.clone()
      return valid
        ? jsonResponse({ valid: true })
        : jsonResponse({ detail: 'This invitation link is invalid, used or expired.' }, 404)
    }
    return jsonResponse({ results: [] })
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

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Make my account' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('JoinPage', () => {
  it('makes the account with the link and opens the new BrainBro', async () => {
    const fetchMock = renderAt('/join/abc')

    expect(await screen.findByRole('heading', { name: 'Join BrainBro' })).toBeInTheDocument()
    fill('ana', 'a-long-pass')

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/join/abc/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'ana', password: 'a-long-pass' }),
      }),
    )
  })

  it('can save an email for password resets when the server sends email', async () => {
    const fetchMock = renderAt('/join/abc', { emailEnabled: true })

    await screen.findByRole('heading', { name: 'Join BrainBro' })
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'ana@example.com' } })
    fill('ana', 'a-long-pass')

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/join/abc/',
      expect.objectContaining({
        body: JSON.stringify({ username: 'ana', password: 'a-long-pass', email: 'ana@example.com' }),
      }),
    )
  })

  it('asks for no email when the server sends none', async () => {
    renderAt('/join/abc')

    await screen.findByRole('heading', { name: 'Join BrainBro' })
    expect(screen.queryByLabelText('Email (optional)')).not.toBeInTheDocument()
  })

  it('says why the account could not be made', async () => {
    renderAt('/join/abc', {
      joined: jsonResponse({ username: ['This username is taken.'] }, 400),
    })

    await screen.findByRole('heading', { name: 'Join BrainBro' })
    fill('alex', 'a-long-pass')

    expect(await screen.findByRole('alert')).toHaveTextContent('This username is taken.')
  })

  it('says when the link no longer works', async () => {
    renderAt('/join/old', { valid: false })

    expect(
      await screen.findByRole('heading', { name: "Can't use this invitation" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This invitation link is invalid, used or expired.',
    )
  })

  it('asks someone signed in to sign out first', async () => {
    renderAt('/join/abc', { authenticated: true })

    expect(await screen.findByText(/signed in as/)).toHaveTextContent('ana')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Join BrainBro' })).toBeInTheDocument()
  })
})
