import { NodeResizer, NodeToolbar, Position, type NodeProps } from '@xyflow/react'
import { Ungroup } from 'lucide-react'
import { memo, useState } from 'react'

import { ColorSwatches } from './ColorSwatches'
import { useBoardActions } from './context'
import { ConnectHandles } from './ConnectHandles'
import type { FrameFlowNode } from './layout'

export const FRAME_COLOR = '#a1a1aa'

/**
 * A group: a titled frame whose cards move with it. Only its title bar and
 * border take the pointer, so a drag inside it still selects what it holds.
 */
export const FrameNode = memo(function FrameNode({ id, data, selected }: NodeProps<FrameFlowNode>) {
  const { readOnly, renameFrame, recolorFrame, ungroupFrame } = useBoardActions()
  const [editing, setEditing] = useState(false)
  const color = data.color || FRAME_COLOR

  function rename(title: string) {
    setEditing(false)
    if (title !== data.title) renameFrame(id, title)
  }

  return (
    <>
      {!readOnly && (
        <>
          <NodeResizer
            isVisible={selected}
            minWidth={120}
            minHeight={80}
            color={color}
            handleClassName="pointer-events-auto"
            lineClassName="pointer-events-auto"
          />
          <NodeToolbar position={Position.Top} offset={36}>
            <div className="popover flex items-center gap-0.5 p-1">
              <ColorSwatches
                value={data.color}
                fallback={FRAME_COLOR}
                onChange={(next) => recolorFrame(id, next)}
              />
              <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
              <button
                type="button"
                aria-label="Ungroup"
                className="button-icon group/tip size-7"
                onClick={() => ungroupFrame(id)}
              >
                <Ungroup className="size-4" aria-hidden="true" />
                <span className="tooltip bottom-full mb-1">Ungroup (⇧⌘G)</span>
              </button>
            </div>
          </NodeToolbar>
        </>
      )}
      <div
        className="h-full w-full rounded-2xl border-2"
        style={{
          borderColor: selected ? color : `color-mix(in srgb, ${color} 55%, transparent)`,
          background: `color-mix(in srgb, ${color} 7%, transparent)`,
        }}
      >
        <div
          className="frame-handle pointer-events-auto absolute -top-7 left-1 flex max-w-full items-center"
          onDoubleClick={() => !readOnly && setEditing(true)}
        >
          {editing ? (
            <input
              autoFocus
              aria-label="Group title"
              defaultValue={data.title}
              className="nodrag input w-56 py-0.5 text-sm"
              onBlur={(event) => rename(event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span
              className={`cursor-grab truncate rounded-md px-1.5 py-0.5 text-sm font-medium ${
                data.title ? '' : 'text-zinc-400 italic dark:text-zinc-500'
              }`}
              style={{ color: data.title ? color : undefined }}
              title={readOnly ? undefined : 'Drag to move · double-click to rename'}
            >
              {data.title || 'Untitled group'}
            </span>
          )}
        </div>
      </div>
      <ConnectHandles id={id} readOnly={readOnly} />
    </>
  )
})
