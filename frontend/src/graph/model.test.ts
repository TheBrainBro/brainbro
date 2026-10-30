import { describe, expect, it } from 'vitest'

import type { Graph } from './api'
import { neighbours, nodeColor, nodeRadius, visibleGraph } from './model'

const graph: Graph = {
  nodes: [
    { id: 'a', type: 'item', kind: 'note', status: 'organized', label: 'A' },
    { id: 'b', type: 'item', kind: 'link', status: 'inbox', label: 'B' },
    { id: 'c', type: 'collection', kind: 'area', label: 'C', color: '', icon: '' },
    { id: 'loose', type: 'item', kind: 'image', status: 'inbox', label: 'Loose' },
  ],
  edges: [
    { source: 'a', target: 'c', type: 'collection' },
    { source: 'a', target: 'b', type: 'link' },
  ],
}

describe('visibleGraph', () => {
  it('hides what has no lines of the chosen kinds', () => {
    const all = visibleGraph(graph, new Set(['collection', 'link']), false)
    expect(all.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
    expect(all.hidden).toBe(1)
    expect(all.degree.get('a')).toBe(2)

    const links = visibleGraph(graph, new Set(['link']), false)
    expect(links.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(links.edges).toHaveLength(1)
  })

  it('shows everything when asked', () => {
    const shown = visibleGraph(graph, new Set(), true)
    expect(shown.nodes).toHaveLength(4)
    expect(shown.edges).toHaveLength(0)
    expect(shown.hidden).toBe(0)
  })
})

describe('helpers', () => {
  it('knows each node’s neighbours, color and size', () => {
    expect(neighbours(graph.edges).get('a')).toEqual(new Set(['c', 'b']))
    expect(nodeColor(graph.nodes[0])).toBe('#8b5cf6')
    expect(nodeColor({ ...graph.nodes[2], color: '#ef4444' } as Graph['nodes'][number])).toBe(
      '#ef4444',
    )
    expect(nodeRadius(graph.nodes[2], 4)).toBeGreaterThan(nodeRadius(graph.nodes[0], 4))
  })
})
