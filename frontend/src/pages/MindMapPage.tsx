import { FolderOpen, Workflow } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { useGraph } from '../graph/api'
import { useOpenNode } from '../graph/open'
import { MindMapCanvas } from '../mindmap/MindMapCanvas'
import { allOpen, type Branch, buildTree, initiallyOpen } from '../mindmap/model'
import { BackLink } from '../ui/BackLink'
import { EmptyState, ErrorState, Loading } from '../ui/states'

/** A collection as a mind map: what it holds, and what that links to, around it. */
export function MindMapPage() {
  const { id = '' } = useParams()
  const graph = useGraph()
  const root = useMemo(() => (graph.data ? buildTree(graph.data, id) : null), [graph.data, id])

  if (graph.isPending) return <Loading />
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
  if (!root || root.node.type !== 'collection') {
    return (
      <EmptyState
        icon={FolderOpen}
        title="This collection no longer exists"
        action={
          <Link to="/collections" className="button-primary">
            See all collections
          </Link>
        }
      />
    )
  }
  // Opened again from the start when the center changes.
  return <MindMap key={id} root={root} />
}

function MindMap({ root }: { root: Branch }) {
  const [open, setOpen] = useState(() => initiallyOpen(root))
  const onOpen = useOpenNode()
  const onToggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const { label } = root.node

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200/80 px-4 py-2 text-sm dark:border-zinc-800/80">
        <BackLink to={`/collections/${root.node.id}`} label={label} />
        {root.children.length > 0 && (
          <div className="ml-auto flex gap-1">
            <button type="button" className="button-ghost" onClick={() => setOpen(allOpen(root))}>
              Unfold all
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => setOpen(new Set([root.node.id]))}
            >
              Fold all
            </button>
          </div>
        )}
      </div>
      <section aria-label={`Mind map of ${label}`} className="relative min-h-0 flex-1">
        {root.children.length ? (
          <MindMapCanvas root={root} open={open} onToggle={onToggle} onOpen={onOpen} />
        ) : (
          <EmptyState icon={Workflow} title={`Nothing in ${label} yet`}>
            Bring items into this collection, and the mind map shows them around it, with the notes
            they link and what they're joined to on boards.
          </EmptyState>
        )}
      </section>
    </div>
  )
}
