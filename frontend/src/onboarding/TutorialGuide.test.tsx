import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TutorialProvider } from './TutorialContext'
import { TutorialGuide } from './TutorialGuide'
import { useTutorial, type Tutorial } from './tutorial'

afterEach(() => vi.unstubAllGlobals())

function renderGuide(props: Partial<Parameters<typeof TutorialGuide>[0]> = {}) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ authenticated: true }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetch)
  const handlers = { onOpenAssistants: vi.fn(), onCloseSettings: vi.fn(), ...props }
  const handle: { current: Tutorial | null } = { current: null }
  function Grab() {
    handle.current = useTutorial()
    return null
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TutorialProvider>
          <Grab />
          <TutorialGuide {...handlers} />
        </TutorialProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { tutorial: handle, fetch, ...handlers }
}

function walkToTheHub(tutorial: { current: Tutorial | null }) {
  act(() => tutorial.current!.start())
  act(() => tutorial.current!.complete('capture'))
  act(() => tutorial.current!.complete('organize', { id: 'c1', name: 'Weekend trip' }))
  act(() => tutorial.current!.complete('organized'))
}

describe('TutorialGuide', () => {
  it('captures, organizes, shows where the note went, then opens the hub', () => {
    const { tutorial } = renderGuide()
    act(() => tutorial.current!.start())
    expect(screen.getByText("Let's save your first idea")).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()

    act(() => tutorial.current!.complete('capture'))
    expect(screen.getByText('Noted, bro! Now give it a home')).toBeInTheDocument()

    act(() => tutorial.current!.complete('organize', { id: 'c1', name: 'Weekend trip' }))
    expect(screen.getByText(/Your note lives in Weekend trip/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('You’re all set, bro!')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lay ideas out on a board/ })).toBeInTheDocument()
  })

  it('only advances from the step it is at', () => {
    const { tutorial } = renderGuide()
    act(() => tutorial.current!.start())
    act(() => tutorial.current!.complete('organize', { id: 'c1', name: 'Weekend trip' }))
    expect(screen.getByText("Let's save your first idea")).toBeInTheDocument()
    expect(tutorial.current!.collection).toBeNull()
  })

  it('walks the graph, then comes back to the hub with it ticked', () => {
    const { tutorial } = renderGuide()
    walkToTheHub(tutorial)

    fireEvent.click(screen.getByRole('button', { name: /See your graph/ }))
    expect(screen.getByText('Your knowledge as a map')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Choose the connections')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Where to next?')).toBeInTheDocument()
    expect(tutorial.current!.seen).toEqual(['graph'])
  })

  it('goes back to the hub from the middle of a track', () => {
    const { tutorial } = renderGuide()
    walkToTheHub(tutorial)
    fireEvent.click(screen.getByRole('button', { name: /Lay ideas out on a board/ }))
    expect(screen.getByText('Lay ideas out in space')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }))
    expect(screen.getByText('You’re all set, bro!')).toBeInTheDocument()
    expect(tutorial.current!.seen).toEqual([])
  })

  it('opens the AI settings for its track and closes them on Continue', () => {
    const { tutorial, onOpenAssistants, onCloseSettings } = renderGuide()
    walkToTheHub(tutorial)

    fireEvent.click(screen.getByRole('button', { name: /Connect your AI/ }))
    expect(onOpenAssistants).toHaveBeenCalled()
    expect(screen.getByText(/Pick your assistant here/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onCloseSettings).toHaveBeenCalled()
    expect(tutorial.current!.seen).toEqual(['assistant'])
  })

  it('adds the examples in the Inbox and says what they are', async () => {
    const { tutorial, fetch } = renderGuide()
    walkToTheHub(tutorial)

    fireEvent.click(screen.getByRole('button', { name: /Add a few examples/ }))
    expect(screen.getByText('Adding examples…')).toBeInTheDocument()
    expect(await screen.findByText('Here they are', undefined, { timeout: 2000 })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/auth/sample-content/', expect.objectContaining({ method: 'POST' }))
  })
})
