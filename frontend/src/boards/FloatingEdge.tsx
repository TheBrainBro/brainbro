import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react'
import { ArrowLeftRight, ArrowRight, Minus, Type } from 'lucide-react'
import { memo, useState } from 'react'

import { useT, type MessageKey } from '../i18n/i18n'
import type { EdgeArrow } from './api'
import { useBoardActions } from './context'
import { ColorSwatches } from './ColorSwatches'
import { size, type BoardEdge } from './layout'

export const EDGE_COLOR = '#a1a1aa'
export const EDGE_SELECTED = '#8b5cf6'

type Point = { x: number; y: number }

function middle(node: InternalNode) {
  const { width, height } = size(node)
  const at = node.internals.positionAbsolute
  return { x: at.x + width / 2, y: at.y + height / 2, width, height }
}

/** Where the line from the middle of `node` towards `toward` leaves its box. */
function exit(node: InternalNode, toward: Point): Point {
  const box = middle(node)
  const dx = toward.x - box.x
  const dy = toward.y - box.y
  if (dx === 0 && dy === 0) return box
  const scale = Math.min(
    dx === 0 ? Infinity : box.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.height / 2 / Math.abs(dy),
  )
  return { x: box.x + dx * scale, y: box.y + dy * scale }
}

/** Which side of `node` a point on its border is on: the way the curve leaves it. */
function side(node: InternalNode, point: Point) {
  const box = middle(node)
  const dx = (point.x - box.x) / box.width
  const dy = (point.y - box.y) / box.height
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Position.Right : Position.Left
  return dy > 0 ? Position.Bottom : Position.Top
}

const PRESSED = 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'

const ARROWS: { arrow: EdgeArrow; label: MessageKey; icon: typeof Minus }[] = [
  { arrow: 'none', label: 'nodes.noArrow', icon: Minus },
  { arrow: 'end', label: 'nodes.arrow', icon: ArrowRight },
  { arrow: 'both', label: 'nodes.bothArrows', icon: ArrowLeftRight },
]

/**
 * A line between two cards or groups, attached wherever their borders face
 * each other (not to fixed handles), so it follows them as they move.
 */
export const FloatingEdge = memo(function FloatingEdge({
  id,
  source,
  target,
  data,
  selected,
  markerStart,
  markerEnd,
}: EdgeProps<BoardEdge>) {
  const t = useT()
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  const { readOnly, updateEdge } = useBoardActions()
  const [editing, setEditing] = useState(false)
  if (!from || !to || !data) return null

  const start = exit(from, middle(to))
  const end = exit(to, middle(from))
  const [path, labelX, labelY] = getBezierPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: side(from, start),
    targetX: end.x,
    targetY: end.y,
    targetPosition: side(to, end),
  })
  const color = selected ? EDGE_SELECTED : data.color || EDGE_COLOR

  function rename(label: string) {
    setEditing(false)
    if (label !== data!.label) updateEdge(id, { label })
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: data.stroke === 'dashed' ? '6 6' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex -translate-1/2 flex-col items-center gap-1"
          style={{ left: labelX, top: labelY }}
          onDoubleClick={() => !readOnly && setEditing(true)}
        >
          {selected && !readOnly && !editing && (
            <div className="popover absolute bottom-full mb-2 flex items-center gap-0.5 p-1">
              {ARROWS.map(({ arrow, label, icon: Icon }) => (
                <button
                  key={arrow}
                  type="button"
                  aria-label={t(label)}
                  aria-pressed={data.arrow === arrow}
                  className={`button-icon group/tip size-7 ${data.arrow === arrow ? PRESSED : ''}`}
                  onClick={() => updateEdge(id, { arrow })}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span className="tooltip bottom-full mb-1">{t(label)}</span>
                </button>
              ))}
              <button
                type="button"
                aria-label={t('nodes.dashed')}
                aria-pressed={data.stroke === 'dashed'}
                className={`button-icon group/tip size-7 ${data.stroke === 'dashed' ? PRESSED : ''}`}
                onClick={() =>
                  updateEdge(id, { stroke: data.stroke === 'dashed' ? 'solid' : 'dashed' })
                }
              >
                <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                  <path d="M1 8h3M7 8h3M13 8h2" stroke="currentColor" strokeWidth="1.75" />
                </svg>
                <span className="tooltip bottom-full mb-1">{t('nodes.dashed')}</span>
              </button>
              <button
                type="button"
                aria-label={t('nodes.label')}
                className="button-icon group/tip size-7"
                onClick={() => setEditing(true)}
              >
                <Type className="size-4" aria-hidden="true" />
                <span className="tooltip bottom-full mb-1">{t('nodes.label')}</span>
              </button>
              <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
              <ColorSwatches
                value={data.color}
                fallback={EDGE_COLOR}
                onChange={(color) => updateEdge(id, { color })}
              />
            </div>
          )}
          {editing ? (
            <input
              autoFocus
              aria-label={t('nodes.edgeLabel')}
              defaultValue={data.label}
              className="input w-40 py-1 text-center text-xs"
              onBlur={(event) => rename(event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            data.label && (
              <span className="w-max max-w-48 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs break-words shadow-xs dark:border-zinc-700 dark:bg-zinc-900">
                {data.label}
              </span>
            )
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})
