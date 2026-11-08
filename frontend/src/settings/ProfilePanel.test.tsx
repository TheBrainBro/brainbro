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
        user: { id: 1, username: 'carlos', email: '', is_staff: false },
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
    fireEvent.change(field, { target: { value: ' Carlos Lugones ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/profile/',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ display_name: 'Carlos Lugones' }),
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
    fireEvent.change(field, { target: { value: 'Carlos' } })
    fireEvent.click(save)

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/profile/',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ handle: 'carlos' }) }),
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
    const fetchMock = renderPanel({ display_name: 'Carlos', avatar_url: '/api/auth/profile/avatar/?v=a' })

    expect(await screen.findByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/auth/profile/avatar/?v=a')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/profile/avatar/',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
