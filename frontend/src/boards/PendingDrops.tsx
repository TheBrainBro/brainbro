import { ViewportPortal } from '@xyflow/react'

import { PendingCard } from '../capture/PendingCard'
import type { PendingCapture } from '../capture/context'

/** Something pasted or dropped on the board, until its item exists: where it will go. */
export type Drop = { id: string; position: { x: number; y: number }; width: number }

/**
 * Cards for what is being captured onto the board, in canvas coordinates
 * but outside the layout: upload progress, then failure with Retry and
 * Dismiss. Each becomes a real card once its item exists.
 */
export function PendingDrops({ drops, pending }: { drops: Drop[]; pending: PendingCapture[] }) {
  const entries = new Map(pending.map((entry) => [entry.id, entry]))
  return (
    <ViewportPortal>
      {drops.map((drop) => {
        const entry = entries.get(drop.id)
        if (!entry) return null
        return (
          <div
            key={drop.id}
            // The viewport lets pointer events through to the pane; these take them.
            className="nodrag nopan pointer-events-auto absolute top-0 left-0"
            style={{
              transform: `translate(${drop.position.x}px, ${drop.position.y}px)`,
              width: drop.width,
            }}
          >
            <PendingCard entry={entry} />
          </div>
        )
      })}
    </ViewportPortal>
  )
}
