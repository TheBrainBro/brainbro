import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Graph } from '../graph/api'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { ViewerProvider } from '../viewer/ViewerProvider'
import { MindMapPage } from './MindMapPage'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderPage(graph: Graph, id = 'c') {
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
      <MemoryRouter initialEntries={[`/collections/${id}/mindmap`]}>
        <FeedbackProvider>
          <ViewerProvider>
            <Routes>
              <Route path="/collections/:id/mindmap" element={<MindMapPage />} />
              <Route path="*" element={<Where />} />
            </Routes>
          </ViewerProvider>
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const graph: Graph = {
  nodes: [
    {
      id: 'c',
      type: 'collection',
      kind: 'area',
      label: 'Trip',
      color: '',
      icon: '',
    },
    { id: 'a', type: 'item', kind: 'note', status: 'organized', label: 'Plan' },
    {
      id: 'b',
      type: 'item',
      kind: 'note',
      status: 'organized',
      label: 'Hotels',
    },
    {
      id: 'x',
      type: 'item',
      kind: 'note',
      status: 'organized',
      label: 'Budget',
    },
  ],
  edges: [
    { source: 'a', target: 'c', type: 'collection' },
    { source: 'a', target: 'b', type: 'link' },
    { source: 'b', target: 'x', type: 'link' },
  ],
}

afterEach(() => vi.unstubAllGlobals())

describe('MindMapPage', () => {
  it('shows the collection and two levels, and folds and unfolds branches', async () => {
    renderPage(graph)

    // React Flow keeps nodes hidden until it measures them, which jsdom can't:
    // the toggles are found by label.
    expect(await screen.findByRole('region', { name: 'Mind map of Trip' })).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Hotels')).toBeInTheDocument()
    expect(screen.queryByText('Budget')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Unfold Hotels'))
    expect(screen.getByText('Budget')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Fold Plan'))
    expect(screen.queryByText('Hotels')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unfold all' }))
    expect(screen.getByText('Budget')).toBeInTheDocument()
  })

  it('opens a note from its name', async () => {
    renderPage(graph)

    fireEvent.click(await screen.findByText('Plan'))

    expect(screen.getByTestId('where')).toHaveTextContent('/notes/a')
  })

  it('says when the collection is empty', async () => {
    renderPage({ nodes: graph.nodes.slice(0, 1), edges: [] })
    expect(await screen.findByText('Nothing in Trip yet')).toBeInTheDocument()
  })

  it('says when the collection no longer exists', async () => {
    renderPage(graph, 'gone')
    expect(await screen.findByText('This collection no longer exists')).toBeInTheDocument()
  })
})
