import { type NodeProps } from '@xyflow/react'
import { memo } from 'react'

import { strokePath, type StrokeFlowNode } from './layout'

/** A pen line. Only the line itself takes the pointer, not the box around it. */
export const StrokeNode = memo(function StrokeNode({ data, selected, width, height }: NodeProps<StrokeFlowNode>) {
  const path = strokePath(data.points)
  return (
    <svg
      width={width}
      height={height}
      className="overflow-visible text-zinc-800 dark:text-zinc-100"
      aria-hidden="true"
    >
      {selected && (
        <path
          d={path}
          fill="none"
          stroke="#8b5cf6"
          strokeOpacity={0.35}
          strokeWidth={data.width + 6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={data.color || 'currentColor'}
        strokeWidth={data.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* A wider, invisible line: easier to click than a thin one. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(data.width, 12)}
        strokeLinecap="round"
        className="pointer-events-auto cursor-move"
      />
    </svg>
  )
})
