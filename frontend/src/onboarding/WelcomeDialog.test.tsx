import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '../App'
import { WelcomeDialog } from './WelcomeDialog'

const user = { id: 1, username: 'alex', email: '', is_staff: true }

const note = {
  id: 'tutorial-note',
  kind: 'note',
  status: 'inbox',
  title: '',
  body: 'Plan a weekend trip',
  collections: [],
  created_at: '2026-11-06T12:00:00Z',
  updated_at: '2026-11-06T12:00:00Z',
}
const trip = { id: 'trip', name: 'Weekend trip', parent: null, kind: 'project', icon: '', color: '', item_count: 0 }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function renderApp() {
  // The inbox has the note once it is captured.
  let captured = false
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/auth/welcome/')) return new Response(null, { status: 204 })
    if (url.includes('/auth/sample-content/')) return new Response(null, { status: 204 })
    if (url.includes('/items/capture/')) {
      captured = true
      return jsonResponse(note)
    }
    if (url.includes('/items/triage/')) return new Response(null, { status: 204 })
    if (url.endsWith('/collections/') && init?.method === 'POST') return jsonResponse(trip)
    if (url.includes('/auth/session/')) return jsonResponse({ authenticated: true, user, welcome_seen: false })
    if (url.includes('/items/note-titles/')) return jsonResponse([])
    if (url.includes('/items/') && captured) return jsonResponse({ results: [note], next: null })
    return jsonResponse({ results: [], next: null })
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
  function renderDialog(props: Partial<Parameters<typeof WelcomeDialog>[0]> = {}) {
    const handlers = { onClose: vi.fn(), onTour: vi.fn(), onExamples: vi.fn(), ...props }
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <WelcomeDialog {...handlers} />
      </QueryClientProvider>,
    )
    return handlers
  }

  it('greets first, and a click skips straight to the choices', async () => {
    const { onTour } = renderDialog()

    expect(screen.getByRole('heading', { name: 'Welcome to BrainBro!' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show me around/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: /Show me around/ }))
    // After the exit animation.
    expect(onTour).not.toHaveBeenCalled()
    await waitFor(() => expect(onTour).toHaveBeenCalled())
  })

  it('brings the choices in on its own after the intro', async () => {
    renderDialog()
    expect(await screen.findByRole('button', { name: /Show me around/ }, { timeout: 4000 })).toBeInTheDocument()
  })

  it('starts empty, leaving once', async () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Start with an empty brain' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('adds the examples before moving on', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { onExamples } = renderDialog()

    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: /Explore with examples/ }))

    await waitFor(() => expect(onExamples).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/sample-content/',
      expect.objectContaining({ body: JSON.stringify({ mcp_url: `${window.location.origin}/api/mcp` }) }),
    )
  })
})

describe('first visit', () => {
  it('starts the tour on an empty inbox, without examples', async () => {
    const fetch = renderApp()
    await screen.findByRole('heading', { name: 'Welcome to BrainBro!' })
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: /Show me around/ }))

    expect(await screen.findByText("Let's save your first idea")).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/sample-content/', expect.anything())
    const capture = await screen.findByRole('textbox', { name: 'Capture' })
    fireEvent.change(capture, { target: { value: 'Plan a weekend trip' } })
    fireEvent.keyDown(capture, { key: 'Enter' })
    expect(await screen.findByText('Noted, bro! Now give it a home')).toBeInTheDocument()

    // Organize into a new collection, from the note itself.
    fireEvent.click(await screen.findByRole('button', { name: 'Organize' }))
    const filter = await screen.findByRole('textbox', { name: 'Find or create a collection' })
    fireEvent.change(filter, { target: { value: 'Weekend trip' } })
    fireEvent.keyDown(filter, { key: 'Enter' })

    expect(await screen.findByText(/Your note lives in Weekend trip/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/items/triage/',
      expect.objectContaining({
        body: JSON.stringify({ ids: ['tutorial-note'], action: 'organize', collections: ['trip'] }),
      }),
    )
  })

  it('shows once, and the account menu brings it back', async () => {
    const fetch = renderApp()

    await screen.findByRole('heading', { name: 'Welcome to BrainBro!' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/auth/welcome/', expect.objectContaining({ method: 'POST' })),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Getting started' }))
    expect(screen.getByRole('heading', { name: 'Welcome to BrainBro!' })).toBeInTheDocument()
  })
})
