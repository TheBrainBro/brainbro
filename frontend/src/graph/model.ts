import { t } from '../i18n/i18n'
import type { EdgeType, Graph, GraphEdge, GraphNode } from './api'

/** What each kind of line means, in the order the filters list them, in the language shown. */
export const EDGE_TYPES: { type: EdgeType; label: string }[] = [
  {
    type: 'collection',
    get label() {
      return t('graph.inCollection')
    },
  },
  {
    type: 'parent',
    get label() {
      return t('graph.parent')
    },
  },
  {
    type: 'board',
    get label() {
      return t('graph.board')
    },
  },
  {
    type: 'link',
    get label() {
      return t('graph.link')
    },
  },
]

export const KIND_COLORS: Record<string, string> = {
  note: '#8b5cf6',
  link: '#3b82f6',
  image: '#10b981',
  file: '#f59e0b',
  audio: '#06b6d4',
  album: '#ec4899',
}
export const COLLECTION_COLOR = '#71717a'

export function nodeColor(node: GraphNode) {
  if (node.type === 'collection') return node.color || COLLECTION_COLOR
  return KIND_COLORS[node.kind] ?? COLLECTION_COLOR
}

export type Visible = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** How many lines each shown node has. */
  degree: Map<string, number>
  /** How many nodes the filters left out for having no lines. */
  hidden: number
}

/**
 * The part of the graph the filters show: only lines of the chosen types,
 * and only nodes with at least one of them unless `unconnected` is on.
 */
export function visibleGraph(graph: Graph, types: Set<EdgeType>, unconnected: boolean): Visible {
  const ids = new Set(graph.nodes.map((node) => node.id))
  const edges = graph.edges.filter(
    (edge) => types.has(edge.type) && ids.has(edge.source) && ids.has(edge.target),
  )
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const nodes = unconnected ? graph.nodes : graph.nodes.filter((node) => degree.has(node.id))
  return { nodes, edges, degree, hidden: graph.nodes.length - nodes.length }
}

/** Each node's neighbours, to light them up with it. */
export function neighbours(edges: GraphEdge[]) {
  const around = new Map<string, Set<string>>()
  for (const { source, target } of edges) {
    if (!around.has(source)) around.set(source, new Set())
    if (!around.has(target)) around.set(target, new Set())
    around.get(source)!.add(target)
    around.get(target)!.add(source)
  }
  return around
}

/** A node's size grows with how connected it is; collections start bigger. */
export function nodeRadius(node: GraphNode, degree: number) {
  const base = node.type === 'collection' ? 8 : 4
  return base + Math.sqrt(degree) * (node.type === 'collection' ? 1.5 : 1)
}
