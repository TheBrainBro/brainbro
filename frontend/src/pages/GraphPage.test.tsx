import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Graph } from '../graph/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { ViewerProvider } from '../viewer/ViewerProvider'
import { GraphPage } from './GraphPage'

function renderPage(graph: Graph) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(graph), {
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <ViewerProvider>
            <GraphPage />
          </ViewerProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const graph: Graph = {
  nodes: [
    { id: 'a', type: 'item', kind: 'note', status: 'organized', label: 'A' },
    { id: 'c', type: 'collection', kind: 'area', label: 'C', color: '', icon: '' },
    { id: 'loose', type: 'item', kind: 'image', status: 'inbox', label: 'Loose' },
  ],
  edges: [{ source: 'a', target: 'c', type: 'collection' }],
}

afterEach(() => vi.unstubAllGlobals())

describe('GraphPage', () => {
  it('draws what is connected and filters by kind of line', async () => {
    renderPage(graph)

    expect(await screen.findByRole('img')).toHaveAccessibleName(
      'Graph of 2 items and collections, 1 connections',
    )
    expect(screen.getByLabelText(/Show unconnected/)).not.toBeChecked()
    expect(screen.getByText('(1)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'In a collection' }))

    expect(screen.getByRole('button', { name: 'In a collection' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText('Nothing is connected yet')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Show unconnected/))

    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Graph of 3 items and collections, 0 connections',
    )
  })

  it('says when there is nothing at all', async () => {
    renderPage({ nodes: [], edges: [] })

    expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()
  })
})
