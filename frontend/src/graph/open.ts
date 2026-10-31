import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'

import { api } from '../lib/api'
import { type Item, itemKey } from '../items/api'
import { useFeedback } from '../ui/feedback'
import { useViewer } from '../viewer/context'
import type { GraphNode } from './api'

/** Opens a graph node where it lives: a collection's page, a note's editor, or the viewer. */
export function useOpenNode() {
  const navigate = useNavigate()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const { toast } = useFeedback()

  return useCallback(
    async (node: GraphNode) => {
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
    },
    [navigate, viewer, queryClient, toast],
  )
}
