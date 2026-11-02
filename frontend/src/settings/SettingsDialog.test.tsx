import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from './SettingsDialog'

function renderDialog(onClose = () => {}, { staff = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/auth/session/'
            ? { authenticated: true, user: { id: 1, username: 'carlos', is_staff: staff } }
            : { results: [] },
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog onClose={onClose} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('SettingsDialog', () => {
  it('opens on the profile page and switches between pages', async () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(screen.getByRole('heading', { name: 'Export' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Create export' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderDialog(onClose)

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('shows invitations to admins only', async () => {
    renderDialog(() => {}, { staff: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Invitations' }))
    expect(screen.getByRole('heading', { name: 'Invitations' })).toBeInTheDocument()
  })

  it('hides invitations from everyone else', async () => {
    renderDialog()
    await screen.findByRole('button', { name: 'Import' })
    expect(screen.queryByRole('button', { name: 'Invitations' })).not.toBeInTheDocument()
  })
})
