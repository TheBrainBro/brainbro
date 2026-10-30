import { useQueryClient } from '@tanstack/react-query'
import { Network } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import type { EdgeType, GraphNode } from '../graph/api'
import { useGraph } from '../graph/api'
import { GraphCanvas } from '../graph/GraphCanvas'
import { COLLECTION_COLOR, EDGE_TYPES, KIND_COLORS, visibleGraph } from '../graph/model'
import { api } from '../lib/api'
import { type Item, itemKey } from '../items/api'
import { KIND_LABEL } from '../items/label'
import { useFeedback } from '../ui/feedback'
import { EmptyState, ErrorState, Loading } from '../ui/states'
import { useViewer } from '../viewer/context'

/** Items and collections as a graph, tied by collections, boards and note links. */
export function GraphPage() {
  const graph = useGraph()
  const navigate = useNavigate()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const { toast } = useFeedback()
  const [types, setTypes] = useState(() => new Set<EdgeType>(EDGE_TYPES.map((e) => e.type)))
  const [unconnected, setUnconnected] = useState(false)
  const visible = useMemo(
    () => (graph.data ? visibleGraph(graph.data, types, unconnected) : null),
    [graph.data, types, unconnected],
  )

  async function open(node: GraphNode) {
    if (node.type === 'collection') return navigate(`/collections/${node.id}`)
    if (node.kind === 'note') return navigate(`/notes/${node.id}`)
    try {
      const item = await queryClient.fetchQuery({
        queryKey: itemKey(node.id),
        queryFn: () => api<Item>(`/items/${node.id}/`),
      })
      viewer.open([item], 0)
    } catch (error) {
      toast({ message: (error as Error).message, tone: 'error' })
    }
  }

  function toggle(type: EdgeType) {
    setTypes((current) => {
      const next = new Set(current)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  if (graph.isPending) return <Loading />
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
  if (!graph.data.nodes.length) {
    return (
      <EmptyState icon={Network} title="Nothing to show yet">
        Capture something, organize it into collections or connect items on a board, and the graph
        shows how it all ties together.
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200/80 px-4 py-2 text-sm dark:border-zinc-800/80">
        <div role="group" aria-label="Connections" className="flex flex-wrap gap-1.5">
          {EDGE_TYPES.map(({ type, label }) => (
            <button
              key={type}
              type="button"
              aria-pressed={types.has(type)}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                types.has(type)
                  ? 'bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-500/15 dark:text-accent-200 dark:ring-accent-500/30'
                  : 'text-zinc-500 ring-zinc-200 hover:text-zinc-800 dark:ring-zinc-800 dark:hover:text-zinc-200'
              }`}
              onClick={() => toggle(type)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={unconnected}
            onChange={(event) => setUnconnected(event.target.checked)}
          />
          Show unconnected
          {!unconnected && visible && visible.hidden > 0 && (
            <span className="text-zinc-400">({visible.hidden})</span>
          )}
        </label>
        <ul
          aria-label="Colors"
          className="ml-auto hidden items-center gap-3 text-xs text-zinc-500 lg:flex"
        >
          {Object.entries(KIND_COLORS).map(([kind, color]) => (
            <li key={kind} className="flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ background: color }} />
              {KIND_LABEL[kind as keyof typeof KIND_LABEL]}
            </li>
          ))}
          <li className="flex items-center gap-1">
            <span className="size-3 rounded-full" style={{ background: COLLECTION_COLOR }} />
            Collection
          </li>
        </ul>
      </div>
      <div className="relative min-h-0 flex-1">
        {visible && visible.nodes.length ? (
          <GraphCanvas visible={visible} onOpen={open} />
        ) : (
          <EmptyState icon={Network} title="Nothing is connected yet">
            Organize items into collections, draw lines between them on a board or link notes with
            [[Title]]. Or turn on Show unconnected.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
