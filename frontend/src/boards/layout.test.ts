import { describe, expect, it } from 'vitest'

import type { Layout } from './api'
import {
  dropSpot,
  dropSpots,
  emptyLayout,
  freeSpot,
  drawFrame,
  groupNodes,
  sameContent,
  settle,
  toLayout,
  toScene,
  ungroup,
  type BoardNode,
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
  it('goes to React Flow and back unchanged', () => {
    const scene = toScene(stored)
    // Groups first: React Flow needs parents before their children.
    expect(scene.nodes.map((node) => node.id)).toEqual(['g', 'a', 'b'])
    expect(scene.nodes[0]).toMatchObject({ type: 'frame', width: 500, data: { title: 'Ideas' } })
    expect(scene.nodes[1]).toMatchObject({ id: 'a', position: { x: 10, y: 20 }, width: 300 })
    expect(scene.nodes[2]).toMatchObject({ height: 120, parentId: 'g', data: { itemId: 'i2' } })
    const layout = toLayout(scene, stored.viewport, stored)
    expect({ ...layout, edges: [] }).toEqual({ ...stored, edges: [] })
    expect(sameContent(layout, stored)).toBe(true)
  })

  it('reads edges saved before they had looks with the defaults', () => {
    const [edge] = toScene(stored).edges
    expect(edge.data).toEqual({ label: '', arrow: 'end', stroke: 'solid', color: '' })
    const looks = { ...edge, data: { ...edge.data!, arrow: 'both' as const, color: '#ef4444' } }
    const layout = toLayout({ nodes: [], edges: [looks] }, stored.viewport, stored)
    expect(layout.edges[0]).toMatchObject({ arrow: 'both', stroke: 'solid', color: '#ef4444' })
    expect(sameContent(layout, stored)).toBe(false)
  })

  it('keeps what it does not know about', () => {
    const future = { ...stored, extra: true } as Layout
    const layout = toLayout({ nodes: [], edges: [] }, { x: 1, y: 2, zoom: 0.5 }, future)
    expect(layout).toMatchObject({ extra: true, viewport: { x: 1, y: 2, zoom: 0.5 } })
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
    const node = toScene(stored).nodes[1]
    const moved = { ...node, position: { x: 1.23456, y: 466.6667 } }
    const layout = toLayout({ nodes: [moved], edges: [] }, stored.viewport, stored)
    expect(layout.nodes[0]).toMatchObject({ x: 1.2, y: 466.7 })
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

describe('groups', () => {
  const card = (id: string, x: number, y: number, parentId?: string): BoardNode => ({
    id,
    type: 'item',
    position: { x, y },
    parentId,
    measured: { width: 200, height: 100 },
    data: { itemId: `i-${id}` },
  })
  const frame = (id: string, x: number, y: number, parentId?: string): BoardNode => ({
    id,
    type: 'frame',
    position: { x, y },
    width: 600,
    height: 400,
    parentId,
    data: { title: '', color: '' },
  })
  const find = (nodes: BoardNode[], id: string) => nodes.find((node) => node.id === id)!

  it('groups the selected cards, keeping them where they are on screen', () => {
    const nodes = [card('a', 100, 100), card('b', 400, 300), card('c', 2000, 0)]
    const next = groupNodes(nodes, ['a', 'b'], 'g')!
    expect(next[0]).toMatchObject({ id: 'g', type: 'frame', selected: true })
    expect(next[0]).toMatchObject({ position: { x: 68, y: 68 }, width: 564, height: 364 })
    expect(find(next, 'a')).toMatchObject({ parentId: 'g', position: { x: 32, y: 32 } })
    expect(find(next, 'b')).toMatchObject({ parentId: 'g', position: { x: 332, y: 232 } })
    expect(find(next, 'c').parentId).toBeUndefined()
  })

  it('groups inside the group the cards share', () => {
    const nodes = [frame('outer', 0, 0), card('a', 50, 50, 'outer'), card('b', 300, 50, 'outer')]
    const next = groupNodes(nodes, ['a', 'b'], 'g')!
    expect(next.map((node) => node.id)).toEqual(['outer', 'g', 'a', 'b'])
    expect(find(next, 'g')).toMatchObject({ parentId: 'outer', position: { x: 18, y: 18 } })
    expect(find(next, 'a')).toMatchObject({ parentId: 'g', position: { x: 32, y: 32 } })
  })

  it('draws a group that takes in what lies wholly inside it', () => {
    const nodes = [card('a', 100, 100), card('b', 450, 100)]
    const next = drawFrame(nodes, { x: 50, y: 50, width: 400, height: 300 }, 'g')
    expect(find(next, 'a')).toMatchObject({ parentId: 'g', position: { x: 50, y: 50 } })
    expect(find(next, 'b').parentId).toBeUndefined()
  })

  it('draws a group inside the one it is drawn in', () => {
    const nodes = [frame('outer', 0, 0), card('a', 100, 100, 'outer')]
    const next = drawFrame(nodes, { x: 50, y: 50, width: 300, height: 200 }, 'g')
    expect(find(next, 'g')).toMatchObject({ parentId: 'outer', position: { x: 50, y: 50 } })
    expect(find(next, 'a')).toMatchObject({ parentId: 'g', position: { x: 50, y: 50 } })
  })

  it('puts a card let go over a group in it, and one let go outside out of it', () => {
    const nodes = [frame('g', 1000, 0), card('a', 1100, 100), card('b', 50, 50, 'g')]
    const next = settle(nodes, ['a', 'b'])
    expect(find(next, 'a')).toMatchObject({ parentId: 'g', position: { x: 100, y: 100 } })
    expect(find(next, 'b')).toMatchObject({ parentId: 'g', position: { x: 50, y: 50 } })

    const out = settle([...nodes.slice(0, 2), card('b', -900, 50, 'g')], ['b'])
    expect(find(out, 'b')).toMatchObject({ parentId: undefined, position: { x: 100, y: 50 } })
  })

  it('does not put a group in itself or in what it holds', () => {
    const nodes = [frame('g', 0, 0), frame('h', 50, 50, 'g')]
    const next = settle(nodes, ['g'])
    expect(find(next, 'g').parentId).toBeUndefined()
  })

  it('ungroups, leaving the cards where they are', () => {
    const nodes = [frame('g', 100, 100), card('a', 50, 50, 'g')]
    const next = ungroup(nodes, 'g')
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'a', parentId: undefined, position: { x: 150, y: 150 } })
  })
})
