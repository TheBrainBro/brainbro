import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import { WelcomeDialog } from './WelcomeDialog'

const user = { id: 1, username: 'carlos', email: '', is_staff: true }

function renderApp() {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes('/auth/welcome/')) return new Response(null, { status: 204 })
    const body = url.includes('/auth/session/')
      ? { authenticated: true, user, welcome_seen: false }
      : url.includes('/items/note-titles/')
        ? []
        : { results: [], next: null }
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/boards']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('WelcomeDialog', () => {
  function renderDialog(onClose: () => void) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WelcomeDialog onClose={onClose} />
      </QueryClientProvider>,
    )
  }

  it('walks through the steps and closes on the last one', () => {
    const onClose = vi.fn()
    renderDialog(onClose)

    expect(screen.getByRole('heading', { name: 'Welcome to your second brain' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'Sort it later' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Go to step 3' }))
    expect(screen.getByRole('heading', { name: 'See it your way' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('heading', { name: 'One memory for your AI' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Add sample content/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('moves with the arrow keys and closes on Escape', () => {
    const onClose = vi.fn()
    renderDialog(onClose)
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: 'Sort it later' })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { name: 'Welcome to your second brain' })).toBeInTheDocument()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('first visit', () => {
  it('creates sample content only when the welcome option is selected', async () => {
    const fetch = renderApp()
    await screen.findByRole('heading', { name: 'Welcome to your second brain' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const option = screen.getByRole('checkbox', { name: /Add sample content/ })
    expect(option).not.toBeChecked()
    fireEvent.click(option)

    await waitFor(() => {
      const request = fetch.mock.calls.find(([url]) => url === '/api/auth/sample-content/')
      expect(request?.[1]?.body).toBe(
        JSON.stringify({ mcp_url: `${window.location.origin}/api/mcp` }),
      )
    })
  })

  it('shows the tour once, and the account menu brings it back', async () => {
    const fetch = renderApp()

    expect(
      await screen.findByRole('heading', { name: 'Welcome to your second brain' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/welcome/',
        expect.objectContaining({ method: 'POST' }),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Welcome tour' }))
    expect(screen.getByRole('heading', { name: 'Welcome to your second brain' })).toBeInTheDocument()
  })
})
