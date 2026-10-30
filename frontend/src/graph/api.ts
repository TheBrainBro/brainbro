import { useQuery } from '@tanstack/react-query'

import { api } from '../lib/api'

export type EdgeType = 'collection' | 'parent' | 'board' | 'link'

export type GraphNode =
  | { id: string; type: 'item'; kind: string; status: string; label: string }
  | {
      id: string
      type: 'collection'
      kind: string
      label: string
      color: string
      icon: string
    }

export type GraphEdge = { source: string; target: string; type: EdgeType; label?: string }

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[] }

export function useGraph() {
  return useQuery({
    queryKey: ['graph'],
    queryFn: () => api<Graph>('/graph/'),
    refetchOnWindowFocus: true,
  })
}
