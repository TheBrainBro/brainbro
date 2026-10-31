import type { EdgeType, Graph, GraphNode } from '../graph/api'

/** A place on the mind map: a node, the line that led to it, and what hangs from it. */
export type Branch = {
  node: GraphNode
  /** The kind of line from its parent; null at the center. */
  via: EdgeType | null
  depth: number
  children: Branch[]
}

/**
 * The mind map around `rootId`: a collection's collections, then its items,
 * then the notes they link and what they're joined to on boards. Breadth
 * first, so each node shows once, as close to the center as it can be.
 */
export function buildTree(graph: Graph, rootId: string): Branch | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const start = byId.get(rootId)
  if (!start) return null

  const inside = new Map<string, string[]>()
  const items = new Map<string, string[]>()
  const ties = new Map<string, { id: string; type: EdgeType }[]>()
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(value)
  }
  for (const { source, target, type } of graph.edges) {
    if (type === 'parent') push(inside, target, source)
    else if (type === 'collection') push(items, target, source)
    else {
      push(ties, source, { id: target, type })
      push(ties, target, { id: source, type })
    }
  }

  const root: Branch = { node: start, via: null, depth: 0, children: [] }
  const seen = new Set([rootId])
  const queue = [root]
  for (let branch = queue.shift(); branch; branch = queue.shift()) {
    const { id } = branch.node
    const next = [
      ...(inside.get(id) ?? []).map((child) => ({ id: child, type: 'parent' as const })),
      ...(items.get(id) ?? []).map((child) => ({ id: child, type: 'collection' as const })),
      ...(ties.get(id) ?? []),
    ]
    for (const { id: childId, type } of next) {
      const node = byId.get(childId)
      if (!node || seen.has(childId)) continue
      seen.add(childId)
      const child = { node, via: type, depth: branch.depth + 1, children: [] }
      branch.children.push(child)
      queue.push(child)
    }
  }
  return root
}

/** The branches that start open: the center and the level after it. */
export function initiallyOpen(root: Branch) {
  return new Set([root.node.id, ...root.children.map((child) => child.node.id)])
}

/** Every branch with something hanging from it, to open them all. */
export function allOpen(root: Branch) {
  const open = new Set<string>()
  const walk = (branch: Branch) => {
    if (!branch.children.length) return
    open.add(branch.node.id)
    branch.children.forEach(walk)
  }
  walk(root)
  return open
}

export type Side = 'left' | 'right'

export type Placed = {
  branch: Branch
  parent: string | null
  side: Side | null
  x: number
  y: number
}

/** How far apart the levels are, and the rows within one. */
export const LEVEL_GAP = 260
export const ROW_GAP = 44

/**
 * Where each shown branch goes: the center at 0,0, its branches split
 * between the right and the left so both sides weigh about the same, and
 * each parent level with the middle of its children.
 */
export function layout(root: Branch, open: Set<string>): Placed[] {
  const shown = (branch: Branch) => (open.has(branch.node.id) ? branch.children : [])
  const rows = (branch: Branch): number => {
    const children = shown(branch)
    return children.length ? children.reduce((sum, child) => sum + rows(child), 0) : 1
  }

  const top = shown(root)
  const weights = top.map(rows)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  // The first branches go right, until it holds about half the rows.
  let split = 0
  for (let right = 0; split < top.length && right + weights[split] / 2 <= total / 2; split++) {
    right += weights[split]
  }
  split = Math.max(split, Math.min(1, top.length))

  const placed: Placed[] = [{ branch: root, parent: null, side: null, x: 0, y: 0 }]
  const side = (branches: Branch[], which: Side) => {
    const count = branches.reduce((sum, branch) => sum + rows(branch), 0)
    let row = (1 - count) / 2
    // Lays a branch out below `row` and returns its y: the middle of its children.
    const place = (branch: Branch, parent: string): number => {
      const index = placed.length
      placed.push({ branch, parent, side: which, x: 0, y: 0 })
      const children = shown(branch)
      let y: number
      if (children.length) {
        const ys = children.map((child) => place(child, branch.node.id))
        y = (ys[0] + ys[ys.length - 1]) / 2
      } else {
        y = row * ROW_GAP
        row += 1
      }
      const x = branch.depth * LEVEL_GAP
      placed[index] = { ...placed[index], x: which === 'right' ? x : -x, y }
      return y
    }
    for (const branch of branches) place(branch, root.node.id)
  }
  side(top.slice(0, split), 'right')
  side(top.slice(split), 'left')
  return placed
}
