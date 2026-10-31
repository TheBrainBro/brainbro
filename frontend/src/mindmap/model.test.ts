import { describe, expect, it } from 'vitest'

import type { Graph, GraphNode } from '../graph/api'
import { allOpen, buildTree, initiallyOpen, layout, LEVEL_GAP, ROW_GAP, type Branch } from './model'

function item(id: string): GraphNode {
  return { id, type: 'item', kind: 'note', status: 'organized', label: id }
}

function collection(id: string): GraphNode {
  return {
    id,
    type: 'collection',
    kind: 'area',
    label: id,
    color: '',
    icon: '',
  }
}

function names(branch: Branch): unknown {
  return branch.children.length ? { [branch.node.id]: branch.children.map(names) } : branch.node.id
}

const graph: Graph = {
  nodes: [
    collection('root'),
    collection('sub'),
    collection('elsewhere'),
    item('a'),
    item('b'),
    item('linked'),
    item('far'),
  ],
  edges: [
    { source: 'sub', target: 'root', type: 'parent' },
    { source: 'a', target: 'root', type: 'collection' },
    { source: 'b', target: 'sub', type: 'collection' },
    // Also in the root: it shows there, closer to the center, not under sub.
    { source: 'a', target: 'sub', type: 'collection' },
    { source: 'a', target: 'linked', type: 'link' },
    { source: 'far', target: 'linked', type: 'board' },
    // Other collections an item is in are not branches of it.
    { source: 'a', target: 'elsewhere', type: 'collection' },
  ],
}

describe('buildTree', () => {
  it('hangs collections, then items, then links and board lines, each once', () => {
    const root = buildTree(graph, 'root')!

    expect(names(root)).toEqual({ root: [{ sub: ['b'] }, { a: [{ linked: ['far'] }] }] })
    expect(root.children.map((child) => child.via)).toEqual(['parent', 'collection'])
    expect(root.children[1].children[0].via).toBe('link')
    expect(root.children[1].children[0].children[0]).toMatchObject({ via: 'board', depth: 3 })
  })

  it('is null for something that is not in the graph', () => {
    expect(buildTree(graph, 'gone')).toBeNull()
  })
})

describe('open branches', () => {
  it('starts with the center and the next level open', () => {
    expect(initiallyOpen(buildTree(graph, 'root')!)).toEqual(new Set(['root', 'sub', 'a']))
  })

  it('opens everything that has branches', () => {
    expect(allOpen(buildTree(graph, 'root')!)).toEqual(new Set(['root', 'sub', 'a', 'linked']))
  })
})

describe('layout', () => {
  it('splits the branches between both sides, parents level with their children', () => {
    const root = buildTree(graph, 'root')!
    const placed = new Map(
      layout(root, allOpen(root)).map((entry) => [entry.branch.node.id, entry]),
    )

    expect(placed.get('root')).toMatchObject({ x: 0, y: 0, side: null, parent: null })
    expect(placed.get('sub')).toMatchObject({ x: LEVEL_GAP, y: 0, side: 'right' })
    expect(placed.get('b')).toMatchObject({ x: 2 * LEVEL_GAP, y: 0, parent: 'sub' })
    expect(placed.get('a')).toMatchObject({ x: -LEVEL_GAP, y: 0, side: 'left' })
    expect(placed.get('far')).toMatchObject({ x: -3 * LEVEL_GAP, y: 0, side: 'left' })
  })

  it('stacks siblings a row apart around their parent', () => {
    const root = buildTree(
      {
        nodes: [collection('root'), item('a'), item('b'), item('c'), item('d')],
        edges: ['a', 'b', 'c', 'd'].map((id) => ({
          source: id,
          target: 'root',
          type: 'collection' as const,
        })),
      },
      'root',
    )!
    const placed = layout(root, initiallyOpen(root))

    expect(placed.map(({ branch, side, y }) => [branch.node.id, side, y])).toEqual([
      ['root', null, 0],
      ['a', 'right', -ROW_GAP / 2],
      ['b', 'right', ROW_GAP / 2],
      ['c', 'left', -ROW_GAP / 2],
      ['d', 'left', ROW_GAP / 2],
    ])
  })

  it('leaves out what hangs from folded branches', () => {
    const root = buildTree(graph, 'root')!
    const ids = layout(root, new Set(['root'])).map((entry) => entry.branch.node.id)

    expect(ids).toEqual(['root', 'sub', 'a'])
  })
})
