import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardSummary } from '../boards/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { BoardsPage } from './BoardsPage'

function board(id: string, title: string): BoardSummary {
  return {
    id,
    title,
    item_count: 0,
    revision: 1,
    created_at: '',
    updated_at: '',
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  const boards = [board('a', 'Alpha'), board('b', 'Beta'), board('c', 'Gamma')]
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/move/')) return new Response(null, { status: 204 })
    return new Response(JSON.stringify({ count: boards.length, results: boards }), {
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <BoardsPage />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function moveCalls() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/move/'))
    .map(([url, init]) => [url, JSON.parse(String((init as RequestInit).body))])
}

const transfer = () => ({
  effectAllowed: '',
  dropEffect: '',
  setData: () => {},
})

describe('BoardsPage sorting', () => {
  it('makes way while dragging, and drops the board where it is shown', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Alpha/ })
    const list = screen.getByRole('list', { name: 'Boards' })
    const card = (title: string) =>
      within(list)
        .getByRole('link', { name: new RegExp(title) })
        .closest('li')!
    const dataTransfer = transfer()
    fireEvent.dragStart(card('Alpha'), { dataTransfer })
    fireEvent.dragOver(card('Gamma'), { dataTransfer })
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.match(/Alpha|Beta|Gamma/)?.[0]),
    ).toEqual(['Beta', 'Gamma', 'Alpha'])
    fireEvent.drop(card('Alpha'), { dataTransfer })
    fireEvent.dragEnd(card('Alpha'), { dataTransfer })
    await waitFor(() => expect(moveCalls()).toEqual([['/api/boards/a/move/', { after: 'c' }]]))
  })

  it("doesn't take a board still gliding into place for one dragged over", async () => {
    renderPage()
    await screen.findByRole('link', { name: /Alpha/ })
    const list = screen.getByRole('list', { name: 'Boards' })
    const card = (title: string) =>
      within(list).getByRole('link', { name: new RegExp(title) }).closest('li')!
    const gliding = card('Beta')
    gliding.getAnimations = () => [{ playState: 'running' } as Animation]
    const dataTransfer = transfer()
    fireEvent.dragStart(card('Alpha'), { dataTransfer })
    fireEvent.dragOver(gliding, { dataTransfer })
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent?.match(/Alpha|Beta|Gamma/)?.[0]),
    ).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('moves the focused board with Alt+arrows', async () => {
    renderPage()
    await screen.findByRole('link', { name: /Alpha/ })
    const list = screen.getByRole('list', { name: 'Boards' })
    const link = within(list).getByRole('link', { name: /Beta/ })
    fireEvent.keyDown(link, { key: 'ArrowRight', altKey: true })
    await waitFor(() => expect(moveCalls()).toEqual([['/api/boards/b/move/', { after: 'c' }]]))
  })

  it("leaves a board where it is when it's already there", async () => {
    renderPage()
    await screen.findByRole('link', { name: /Alpha/ })
    const list = screen.getByRole('list', { name: 'Boards' })
    fireEvent.keyDown(within(list).getByRole('link', { name: /Alpha/ }), {
      key: 'ArrowUp',
      altKey: true,
    })
    expect(moveCalls()).toEqual([])
  })
})
