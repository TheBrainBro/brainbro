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

const signedIn = { authenticated: true, user: { id: 1, username: 'alex' }, welcome_seen: true }

function renderAt(
  path: string,
  {
    emailEnabled = true,
    validLink = true,
    reset = jsonResponse(signedIn),
    requested = new Response(null, { status: 204 }),
  } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse({ authenticated: false, user: null, email_enabled: emailEnabled })
    }
    if (url === '/api/auth/password-reset/') return requested.clone()
    if (url.startsWith('/api/auth/password-reset/')) {
      if (init?.method === 'POST') return reset.clone()
      return validLink
        ? jsonResponse({ username: 'alex' })
        : jsonResponse({ detail: 'This link is invalid, used or expired.' }, 404)
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

afterEach(() => vi.unstubAllGlobals())

describe('Password reset', () => {
  it('offers the reset on the sign-in page only when the server can email', async () => {
    renderAt('/login')
    expect(await screen.findByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('hides it when the server has no email', async () => {
    renderAt('/login', { emailEnabled: false })
    await screen.findByRole('button', { name: 'Sign in' })
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).not.toBeInTheDocument()
  })

  it('asks for a link by email and says it is on its way', async () => {
    const fetchMock = renderAt('/forgot-password')

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: ' alex@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }))

    expect(await screen.findByRole('status')).toHaveTextContent('alex@example.com')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'alex@example.com' }) }),
    )
  })

  it('sets the new password with the link and opens the app', async () => {
    const fetchMock = renderAt('/reset-password/MQ/abc-123')

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    expect(screen.getByText('alex')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }))

    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/password-reset/MQ/abc-123/',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'a-new-pass' }) }),
    )
  })

  it('says why the password was refused', async () => {
    renderAt('/reset-password/MQ/abc-123', {
      reset: jsonResponse({ password: ['This password is too common.'] }, 400),
    })

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This password is too common.')
  })

  it('says when the link no longer works', async () => {
    renderAt('/reset-password/MQ/old', { validLink: false })

    expect(await screen.findByRole('heading', { name: "Can't use this link" })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This link is invalid, used or expired.')
  })
})
