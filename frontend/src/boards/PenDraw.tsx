import { useState } from 'react'

type Point = { x: number; y: number }

// Points closer than this (in screen pixels) add nothing but weight.
const MIN_STEP = 2

/** Over the canvas while the pen is on: each drag is a line, handed over in screen points. */
export function PenDraw({
  color,
  width,
  zoom,
  onDraw,
}: {
  color: string
  width: number
  zoom: number
  onDraw: (points: Point[]) => void
}) {
  const [points, setPoints] = useState<Point[] | null>(null)

  return (
    <div
      aria-label="Draw"
      className="absolute inset-0 z-[4] cursor-crosshair touch-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setPoints([{ x: event.clientX, y: event.clientY }])
      }}
      onPointerMove={(event) => {
        if (!points) return
        const last = points[points.length - 1]
        if (Math.hypot(event.clientX - last.x, event.clientY - last.y) < MIN_STEP) return
        setPoints([...points, { x: event.clientX, y: event.clientY }])
      }}
      onPointerUp={() => {
        if (points && points.length > 1) onDraw(points)
        setPoints(null)
      }}
    >
      {points && (
        <svg className="pointer-events-none fixed inset-0 size-full text-zinc-800 dark:text-zinc-100">
          <polyline
            points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={width * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  )
}
