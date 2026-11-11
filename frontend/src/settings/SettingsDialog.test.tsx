import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeedbackProvider } from '../ui/FeedbackProvider'
import { SettingsDialog } from './SettingsDialog'

function renderDialog(onClose = () => {}, { staff = false, hasSamples = false } = {}) {
  let samplesPresent = hasSamples
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return new Response(
        JSON.stringify({
          authenticated: true,
          has_sample_content: samplesPresent,
          user: { id: 1, username: 'alex', is_staff: staff },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (url === '/api/auth/sample-content/' && init?.method === 'DELETE') {
      samplesPresent = false
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify({ results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <SettingsDialog onClose={onClose} />
      </FeedbackProvider>
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

  it('hides the sample content section when the account has none', async () => {
    renderDialog()
    await screen.findByRole('button', { name: 'Import' })
    expect(screen.queryByRole('button', { name: 'Sample content' })).not.toBeInTheDocument()
  })

  it('hides the sample content section after its content is removed', async () => {
    renderDialog(() => {}, { hasSamples: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Sample content' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove sample content' }))
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'Remove sample content?',
    })
    fireEvent.click(confirmation.querySelector('button.button-danger')!)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Sample content' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    })
  })
})
