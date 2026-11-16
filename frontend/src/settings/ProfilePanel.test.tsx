import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfilePanel } from './ProfilePanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderPanel(
  profile: { display_name: string; handle?: string; avatar_url: string | null } = {
    display_name: '',
    avatar_url: null,
  },
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse({
        authenticated: true,
        user: { id: 1, username: 'alex', email: '', is_staff: false },
        profile,
      })
    }
    if (url === '/api/auth/profile/') {
      const changes = JSON.parse(String(init?.body))
      if (changes.handle === 'taken') {
        return jsonResponse({ handle: ['Someone else already has this name.'] }, 400)
      }
      return jsonResponse({ ...profile, ...changes })
    }
    if (url === '/api/auth/email/') {
      const { email } = JSON.parse(String(init?.body))
      if (email === 'taken@example.com') {
        return jsonResponse({ email: ['Another account already uses this email.'] }, 400)
      }
      return jsonResponse({ email })
    }
    if (url === '/api/auth/profile/avatar/' && init?.method === 'DELETE') {
      return jsonResponse({ ...profile, avatar_url: null })
    }
    return jsonResponse({ detail: 'Not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ProfilePanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('ProfilePanel', () => {
  it('saves the display name', async () => {
    const fetchMock = renderPanel()

    const field = await screen.findByLabelText('Display name')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(field, { target: { value: ' Alex Rivera ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/profile/',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ display_name: 'Alex Rivera' }),
        }),
      ),
    )
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
  })

  it('saves the public address, lowercase', async () => {
    const fetchMock = renderPanel({ display_name: '', handle: 'author', avatar_url: null })

    const field = await screen.findByLabelText('Public address')
    await vi.waitFor(() => expect(field).toHaveValue('author'))
    const save = screen.getByRole('button', { name: 'Save public address' })
    expect(save).toBeDisabled()
    fireEvent.change(field, { target: { value: 'Alex' } })
    fireEvent.click(save)

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/profile/',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ handle: 'alex' }) }),
      ),
    )
  })

  it('says when the public address is taken', async () => {
    renderPanel({ display_name: '', handle: 'author', avatar_url: null })

    fireEvent.change(await screen.findByLabelText('Public address'), { target: { value: 'taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save public address' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else already has this name.')
  })

  it('shows the photo and removes it', async () => {
    const fetchMock = renderPanel({ display_name: 'Alex', avatar_url: '/api/auth/profile/avatar/?v=a' })

    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/auth/profile/avatar/?v=a')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile/avatar/',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('saves the email for password resets', async () => {
    const fetchMock = renderPanel()

    const input = await screen.findByLabelText('Email')
    fireEvent.change(input, { target: { value: 'alex@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save email' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/email/',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ email: 'alex@example.com' }) }),
      ),
    )
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save email' })).toBeDisabled())
    expect(input).toHaveValue('alex@example.com')
  })

  it('says why the email was refused', async () => {
    renderPanel()

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'taken@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Another account already uses this email.')
  })

  it('says when the server cannot send email yet', async () => {
    renderPanel()

    expect(await screen.findByText(/can't send email yet/)).toBeInTheDocument()
  })
})
