import { useState, type PointerEvent } from 'react'

import { useT } from '../i18n/i18n'

import type { Box } from './layout'

/** Over the canvas while the group tool is on: drag a box (or click) to draw a group. */
export function FrameDraw({ onDraw }: { onDraw: (screen: Box) => void }) {
  const t = useT()
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<Box | null>(null)

  function boxTo(event: PointerEvent) {
    const from = start!
    return {
      x: Math.min(from.x, event.clientX),
      y: Math.min(from.y, event.clientY),
      width: Math.abs(event.clientX - from.x),
      height: Math.abs(event.clientY - from.y),
    }
  }

  return (
    <div
      aria-label={t('nodes.drawGroup')}
      className="absolute inset-0 z-[4] cursor-crosshair"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setStart({ x: event.clientX, y: event.clientY })
      }}
      onPointerMove={(event) => start && setBox(boxTo(event))}
      onPointerUp={(event) => {
        if (!start) return
        const drawn = boxTo(event)
        setStart(null)
        setBox(null)
        onDraw(drawn)
      }}
    >
      {box && (
        <div
          className="fixed rounded-2xl border-2 border-accent-500 bg-accent-500/5"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
    </div>
  )
}
