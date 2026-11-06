import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TutorialProgress } from '../auth/session'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { TutorialProvider } from './TutorialContext'
import { TutorialGuide } from './TutorialGuide'
import { TutorialPill } from './TutorialPill'

afterEach(() => vi.unstubAllGlobals())

function renderWith(tutorial: TutorialProgress) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
    url.includes('/auth/tutorial/')
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ authenticated: true, user: { id: 1 }, tutorial }), {
          headers: { 'Content-Type': 'application/json' },
        }),
  )
  vi.stubGlobal('fetch', fetch)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <FeedbackProvider>
          <TutorialProvider>
            <TutorialPill />
            <TutorialGuide onOpenAssistants={vi.fn()} onCloseSettings={vi.fn()} />
          </TutorialProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return fetch
}

describe('TutorialPill', () => {
  it('waits in the corner and picks the tour up at the hub, ticks kept', async () => {
    renderWith({ started: true, done: ['loop', 'graph'], closed: false })

    fireEvent.click(await screen.findByRole('button', { name: /Getting started.*2 of 5 done/ }))
    expect(screen.getByText('Where to next?')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()

    // Closed again, it goes back to the corner.
    fireEvent.click(screen.getAllByRole('button', { name: 'Exit tutorial' })[0])
    expect(await screen.findByRole('region', { name: 'Getting started' })).toBeInTheDocument()
  })

  it('starts over from the capture when the first loop was not finished', async () => {
    renderWith({ started: true, done: [], closed: false })
    fireEvent.click(await screen.findByRole('button', { name: /Getting started/ }))
    expect(screen.getByText("Let's save your first idea")).toBeInTheDocument()
  })

  it('is put away for good from its own close', async () => {
    const fetch = renderWith({ started: true, done: ['loop'], closed: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Hide for good' }))

    expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()
    expect(screen.getByText(/You can bring it back from your account menu/)).toBeInTheDocument()
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/tutorial/',
        expect.objectContaining({ body: JSON.stringify({ action: 'close' }) }),
      ),
    )
  })

  it('stays away when the tour was never started, or was put away', async () => {
    renderWith({ started: true, done: ['loop'], closed: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()
  })
})
