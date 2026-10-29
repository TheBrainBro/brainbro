import { describe, expect, it } from 'vitest'

import type { Layout } from './api'
import {
  dropSpot,
  dropSpots,
  emptyLayout,
  freeSpot,
  sameContent,
  toFlowNodes,
  toLayout,
  type ItemFlowNode,
} from './layout'

const stored: Layout = {
  ...emptyLayout(),
  nodes: [
    { id: 'a', type: 'item', item: 'i1', x: 10, y: 20, w: 300, h: null, parent: null },
    { id: 'b', type: 'item', item: 'i2', x: -5, y: 0, w: null, h: 120, parent: 'g' },
  ],
  groups: [{ id: 'g', title: 'Ideas', color: '', x: 0, y: 0, w: 500, h: 400, parent: null }],
  edges: [{ id: 'e', source: 'a', target: 'b', label: '' }],
}

describe('layout', () => {
  it('goes to React Flow nodes and back unchanged', () => {
    const nodes = toFlowNodes(stored)
    expect(nodes[0]).toMatchObject({ id: 'a', position: { x: 10, y: 20 }, width: 300 })
    expect(nodes[1]).toMatchObject({ height: 120, parentId: 'g', data: { itemId: 'i2' } })
    expect(toLayout(nodes, stored.viewport, stored)).toEqual(stored)
  })

  it('keeps groups and edges it does not edit', () => {
    const layout = toLayout([], { x: 1, y: 2, zoom: 0.5 }, stored)
    expect(layout.groups).toBe(stored.groups)
    expect(layout.edges).toBe(stored.edges)
    expect(layout.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })

  it('tells changes worth saving from panning alone', () => {
    const panned = { ...stored, viewport: { x: 50, y: 0, zoom: 2 } }
    expect(sameContent(stored, panned)).toBe(true)
    expect(sameContent(stored, { ...stored, edges: [] })).toBe(false)
    expect(sameContent(stored, { ...stored, nodes: stored.nodes.slice(1) })).toBe(false)
  })

  it('compares layouts whatever order the server keeps their keys in', () => {
    const fromServer = JSON.parse(
      '{"edges":[{"id":"e","label":"","source":"a","target":"b"}],"groups":[{"h":400,"id":"g",' +
        '"color":"","parent":null,"title":"Ideas","w":500,"x":0,"y":0}],"nodes":[{"h":null,' +
        '"id":"a","item":"i1","parent":null,"type":"item","w":300,"x":10,"y":20},{"h":120,' +
        '"id":"b","item":"i2","parent":"g","type":"item","w":null,"x":-5,"y":0}],' +
        '"schema_version":1,"viewport":{"x":0,"y":0,"zoom":1}}',
    ) as Layout
    expect(sameContent(stored, fromServer)).toBe(true)
  })

  it('rounds sub-pixel positions', () => {
    const [node] = toFlowNodes(stored)
    const moved = { ...node, position: { x: 1.23456, y: 466.6667 } }
    expect(toLayout([moved], stored.viewport, stored).nodes[0]).toMatchObject({ x: 1.2, y: 466.7 })
  })
})

describe('freeSpot', () => {
  const card = (x: number, y: number): ItemFlowNode => ({
    id: `${x},${y}`,
    type: 'item',
    position: { x, y },
    measured: { width: 280, height: 160 },
    data: { itemId: `${x},${y}` },
  })

  it('takes the center when it is free', () => {
    expect(freeSpot({ x: 0, y: 0 }, 280, [])).toEqual({ x: -140, y: -80 })
  })

  it('moves next to cards in the way', () => {
    const taken = [card(-140, -80)]
    const spot = freeSpot({ x: 0, y: 0 }, 280, taken)
    expect(spot).not.toEqual({ x: -140, y: -80 })
    const box = { ...spot, width: 280, height: 160 }
    expect(box.x >= 164 || box.x + 280 <= -164 || box.y >= 104 || box.y + 160 <= -104).toBe(true)
  })
})

describe('dropSpot', () => {
  it('puts the card under the pointer, held near its top', () => {
    expect(dropSpot({ x: 100, y: 100 }, 280, [])).toEqual({ x: -40, y: 76 })
  })

  it('stacks several cards dropped together below the pointer', () => {
    const [first, second] = dropSpots({ x: 100, y: 100 }, [280, 260], [])
    expect(first).toEqual({ x: -40, y: 76 })
    expect(second).toEqual({ x: -30, y: 260 })
  })

  it('moves aside from a card already there', () => {
    const there = { position: { x: -40, y: 76 }, width: 280, height: 160 }
    expect(dropSpot({ x: 100, y: 100 }, 280, [there])).not.toEqual({ x: -40, y: 76 })
  })
})
