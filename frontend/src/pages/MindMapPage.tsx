import { FolderOpen, Workflow } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'

import { useGraph } from '../graph/api'
import { useOpenNode } from '../graph/open'
import { useT } from '../i18n/i18n'
import { MindMapCanvas } from '../mindmap/MindMapCanvas'
import { allOpen, type Branch, buildTree, initiallyOpen } from '../mindmap/model'
import { BackLink } from '../ui/BackLink'
import { EmptyState, ErrorState, Loading } from '../ui/states'

/** A collection as a mind map: what it holds, and what that links to, around it. */
export function MindMapPage() {
  const t = useT()
  const { id = '' } = useParams()
  const graph = useGraph()
  const root = useMemo(() => (graph.data ? buildTree(graph.data, id) : null), [graph.data, id])

  if (graph.isPending) return <Loading />
  if (graph.isError) return <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
  if (!root || root.node.type !== 'collection') {
    return (
      <EmptyState
        icon={FolderOpen}
        title={t('collections.gone')}
        action={
          <Link to="/collections" className="button-primary">
            {t('collections.seeAll')}
          </Link>
        }
      />
    )
  }
  // Opened again from the start when the center changes.
  return <MindMap key={id} root={root} />
}

function MindMap({ root }: { root: Branch }) {
  const t = useT()
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
              {t('mindMap.unfoldAll')}
            </button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => setOpen(new Set([root.node.id]))}
            >
              {t('mindMap.foldAll')}
            </button>
          </div>
        )}
      </div>
      <section aria-label={t('mindMap.of', { name: label })} className="relative min-h-0 flex-1">
        {root.children.length ? (
          <MindMapCanvas root={root} open={open} onToggle={onToggle} onOpen={onOpen} />
        ) : (
          <EmptyState icon={Workflow} title={t('mindMap.nothingIn', { name: label })}>
            {t('mindMap.nothingHint')}
          </EmptyState>
        )}
      </section>
    </div>
  )
}
