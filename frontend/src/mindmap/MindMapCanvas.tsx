import '@xyflow/react/dist/style.css'

import {
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Minus } from 'lucide-react'
import { useMemo } from 'react'

import { EDGE_COLOR } from '../boards/FloatingEdge'
import type { EdgeType, GraphNode } from '../graph/api'
import { nodeColor } from '../graph/model'
import { type Branch, layout, type Side } from './model'

type BranchData = {
  branch: Branch
  side: Side | null
  open: boolean
  onToggle: (id: string) => void
  onOpen: (node: GraphNode) => void
}
type BranchNode = Node<BranchData, 'branch'>

const nodeTypes = { branch: BranchCard }

// Hidden: the lines need somewhere to start and end, not something to grab.
const HANDLE = { opacity: 0, pointerEvents: 'none' } as const

function lineColor(via: EdgeType | null) {
  if (via === 'board') return '#3b82f6'
  if (via === 'link') return '#8b5cf6'
  return EDGE_COLOR
}

/** One node: its name opens it, and the button on its outer side folds what hangs from it. */
function BranchCard({ data }: NodeProps<BranchNode>) {
  const { branch, side, open, onToggle, onOpen } = data
  const { node } = branch
  const root = side === null
  const count = branch.children.length
  const toggle = count > 0 && !root && (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Fold' : 'Unfold'} ${node.label}`}
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 px-1 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      onClick={() => onToggle(node.id)}
    >
      {open ? <Minus className="size-3" aria-hidden="true" /> : count}
    </button>
  )

  return (
    <div
      className={`surface flex items-center gap-2 px-2.5 ${
        root ? 'w-60 py-2.5 text-base font-semibold' : 'w-52 py-1.5 text-sm'
      } ${side === 'left' ? 'flex-row-reverse' : ''}`}
    >
      {root ? (
        <>
          <Handle type="source" id="right" position={Position.Right} style={HANDLE} />
          <Handle type="source" id="left" position={Position.Left} style={HANDLE} />
        </>
      ) : (
        <>
          <Handle
            type="target"
            position={side === 'left' ? Position.Right : Position.Left}
            style={HANDLE}
          />
          <Handle
            type="source"
            position={side === 'left' ? Position.Left : Position.Right}
            style={HANDLE}
          />
        </>
      )}
      <button
        type="button"
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md hover:text-accent-700 dark:hover:text-accent-300 ${
          side === 'left' ? 'flex-row-reverse text-right' : 'text-left'
        }`}
        onClick={() => onOpen(node)}
      >
        <span
          className={`shrink-0 rounded-full ${node.type === 'collection' ? 'size-3' : 'size-2'}`}
          style={{ background: nodeColor(node) }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </button>
      {toggle}
    </div>
  )
}

/**
 * The mind map, laid out from the center and drawn with React Flow. Only
 * to look at: drag or scroll to move around, click a name to open it.
 */
export function MindMapCanvas({
  root,
  open,
  onToggle,
  onOpen,
}: {
  root: Branch
  open: Set<string>
  onToggle: (id: string) => void
  onOpen: (node: GraphNode) => void
}) {
  const { nodes, edges } = useMemo(() => {
    const placed = layout(root, open)
    const nodes: BranchNode[] = placed.map(({ branch, side, x, y }) => ({
      id: branch.node.id,
      type: 'branch',
      position: { x, y },
      data: { branch, side, open: open.has(branch.node.id), onToggle, onOpen },
    }))
    const edges: Edge[] = placed.flatMap(({ branch, parent, side }) =>
      parent
        ? [
            {
              id: `${parent}-${branch.node.id}`,
              source: parent,
              target: branch.node.id,
              sourceHandle: parent === root.node.id ? side : undefined,
              style: { stroke: lineColor(branch.via), strokeWidth: 1.5 },
            },
          ]
        : [],
    )
    return { nodes, edges }
  }, [root, open, onToggle, onOpen])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      // Positions are each node's middle, so both sides line up with the center.
      nodeOrigin={[0.5, 0.5]}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      colorMode="system"
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
