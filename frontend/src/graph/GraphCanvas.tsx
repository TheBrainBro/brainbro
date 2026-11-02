import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useEffect, useRef } from 'react'

import { useT } from '../i18n/i18n'
import { useDark } from '../theme/theme'
import type { EdgeType, GraphEdge, GraphNode } from './api'
import { neighbours, nodeColor, nodeRadius, type Visible } from './model'

type SimNode = SimulationNodeDatum & {
  id: string
  node: GraphNode
  radius: number
  color: string
}
type SimLink = SimulationLinkDatum<SimNode> & { edge: GraphEdge }
type View = { x: number; y: number; k: number }

const MIN_ZOOM = 0.1
const MAX_ZOOM = 6
// Past this many pixels a press is a drag, not a click.
const CLICK_SLOP = 4
const LINK_DISTANCE: Record<EdgeType, number> = {
  collection: 40,
  parent: 70,
  board: 60,
  link: 60,
}

function edgeStyle(type: EdgeType, dark: boolean) {
  switch (type) {
    case 'collection':
      return { color: dark ? '#52525b' : '#d4d4d8', width: 1, dash: [] }
    case 'parent':
      return { color: dark ? '#a1a1aa' : '#71717a', width: 1.5, dash: [4, 3] }
    case 'board':
      return { color: '#3b82f6', width: 1.5, dash: [] }
    case 'link':
      return { color: '#8b5cf6', width: 1.5, dash: [] }
  }
}

/**
 * The graph, laid out by a force simulation and drawn on a canvas. Drag the
 * background to pan, scroll or pinch to zoom, drag a node to move it, hover
 * one to light up what it's tied to, and click it to open it.
 */
export function GraphCanvas({
  visible,
  onOpen,
}: {
  visible: Visible
  onOpen: (node: GraphNode) => void
}) {
  const t = useT()
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const dark = useDark()
  const state = useRef({
    nodes: [] as SimNode[],
    links: [] as SimLink[],
    around: new Map<string, Set<string>>(),
    view: { x: 0, y: 0, k: 1 } as View,
    size: { width: 0, height: 0 },
    hovered: null as SimNode | null,
    simulation: null as Simulation<SimNode, SimLink> | null,
    fitted: false,
    dark,
    frame: 0,
  })
  // Read from pointer handlers, so it's kept in a ref.
  const open = useRef(onOpen)
  useEffect(() => {
    open.current = onOpen
  }, [onOpen])

  function draw() {
    const s = state.current
    cancelAnimationFrame(s.frame)
    s.frame = requestAnimationFrame(() => {
      if (canvas.current) paint(s, canvas.current)
    })
  }

  useEffect(() => {
    state.current.dark = dark
    draw()
  }, [dark])

  // A new graph or new filters: keep where known nodes were, so nothing jumps.
  useEffect(() => {
    const s = state.current
    const previous = new Map(s.nodes.map((node) => [node.id, node]))
    s.nodes = visible.nodes.map((node) => {
      const before = previous.get(node.id)
      return {
        id: node.id,
        node,
        radius: nodeRadius(node, visible.degree.get(node.id) ?? 0),
        color: nodeColor(node),
        x: before?.x,
        y: before?.y,
      }
    })
    s.links = visible.edges.map((edge) => ({ source: edge.source, target: edge.target, edge }))
    s.around = neighbours(visible.edges)
    if (s.hovered && !s.nodes.some((node) => node.id === s.hovered!.id)) s.hovered = null
    if (!previous.size) s.fitted = false

    s.simulation?.stop()
    const simulation = forceSimulation(s.nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(s.links)
          .id((node) => node.id)
          .distance((link) => LINK_DISTANCE[link.edge.type]),
      )
      .force('charge', forceManyBody<SimNode>().strength(-80).distanceMax(500))
      .force('x', forceX<SimNode>().strength(0.04))
      .force('y', forceY<SimNode>().strength(0.04))
      .force(
        'collide',
        forceCollide<SimNode>().radius((node) => node.radius + 3),
      )
      .on('tick', () => {
        if (!s.fitted && simulation.alpha() < 0.3) {
          fit(s)
          s.fitted = true
        }
        draw()
      })
    if (previous.size) simulation.alpha(0.3)
    s.simulation = simulation
    return () => {
      simulation.stop()
    }
  }, [visible])

  // Size the canvas to its box, sharp on high-density screens.
  useEffect(() => {
    const box = container.current
    if (!box) return
    const observer = new ResizeObserver(([entry]) => {
      const s = state.current
      const { width, height } = entry.contentRect
      const first = !s.size.width
      s.size = { width, height }
      const element = canvas.current
      if (element) {
        const ratio = window.devicePixelRatio || 1
        element.width = Math.round(width * ratio)
        element.height = Math.round(height * ratio)
      }
      if (first) s.view = { x: width / 2, y: height / 2, k: 1 }
      draw()
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // Wheel zoom needs a listener that can prevent the page from scrolling.
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const s = state.current
      const point = local(element!, event)
      const k = clamp(s.view.k * Math.exp(-event.deltaY * 0.002), MIN_ZOOM, MAX_ZOOM)
      s.view = {
        x: point.x - ((point.x - s.view.x) * k) / s.view.k,
        y: point.y - ((point.y - s.view.y) * k) / s.view.k,
        k,
      }
      draw()
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const press = useRef<{
    x: number
    y: number
    node: SimNode | null
    moved: boolean
    view: View
  } | null>(null)

  return (
    <div ref={container} className="absolute inset-0">
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('graph.canvas', { nodes: visible.nodes.length, edges: visible.edges.length })}
        className="size-full touch-none"
        onPointerDown={(event) => {
          const s = state.current
          const point = local(event.currentTarget, event)
          const node = hit(s, point)
          press.current = { ...point, node, moved: false, view: s.view }
          event.currentTarget.setPointerCapture(event.pointerId)
          if (node) {
            node.fx = node.x
            node.fy = node.y
          }
        }}
        onPointerMove={(event) => {
          const s = state.current
          const point = local(event.currentTarget, event)
          const current = press.current
          if (!current) {
            const node = hit(s, point)
            if (node !== s.hovered) {
              s.hovered = node
              event.currentTarget.style.cursor = node ? 'pointer' : ''
              draw()
            }
            return
          }
          if (Math.hypot(point.x - current.x, point.y - current.y) > CLICK_SLOP) {
            current.moved = true
          }
          if (!current.moved) return
          if (current.node) {
            const world = toWorld(s.view, point)
            current.node.fx = world.x
            current.node.fy = world.y
            s.simulation?.alphaTarget(0.3).restart()
          } else {
            s.view = {
              ...current.view,
              x: current.view.x + point.x - current.x,
              y: current.view.y + point.y - current.y,
            }
            draw()
          }
        }}
        onPointerUp={(event) => {
          const s = state.current
          const current = press.current
          press.current = null
          if (!current) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (current.node) {
            current.node.fx = null
            current.node.fy = null
            s.simulation?.alphaTarget(0)
            if (!current.moved) open.current(current.node.node)
          }
        }}
        onPointerLeave={() => {
          const s = state.current
          if (s.hovered && !press.current) {
            s.hovered = null
            draw()
          }
        }}
      />
    </div>
  )
}

type S = {
  nodes: SimNode[]
  links: SimLink[]
  around: Map<string, Set<string>>
  view: View
  size: { width: number; height: number }
  hovered: SimNode | null
  dark: boolean
}

function paint(s: S, element: HTMLCanvasElement) {
  const context = element.getContext('2d')
  if (!context) return
  const ratio = window.devicePixelRatio || 1
  const { view, hovered, dark } = s
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, element.width, element.height)
  context.setTransform(ratio * view.k, 0, 0, ratio * view.k, ratio * view.x, ratio * view.y)

  // While a node is hovered, it and what it's tied to stay lit; the rest fades.
  const lit = hovered ? new Set([hovered.id, ...(s.around.get(hovered.id) ?? [])]) : null

  for (const link of s.links) {
    const source = link.source as SimNode
    const target = link.target as SimNode
    const style = edgeStyle(link.edge.type, dark)
    const touches = hovered && (source.id === hovered.id || target.id === hovered.id)
    context.globalAlpha = lit && !touches ? 0.08 : 0.9
    context.strokeStyle = style.color
    context.lineWidth = style.width / view.k
    context.setLineDash(style.dash.map((length) => length / view.k))
    context.beginPath()
    context.moveTo(source.x ?? 0, source.y ?? 0)
    context.lineTo(target.x ?? 0, target.y ?? 0)
    context.stroke()
  }
  context.setLineDash([])

  for (const node of s.nodes) {
    const archived = node.node.type === 'item' && node.node.status === 'archived'
    const faded = lit && !lit.has(node.id)
    context.globalAlpha = faded ? 0.15 : archived ? 0.5 : 1
    context.fillStyle = node.color
    context.beginPath()
    context.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2)
    context.fill()
    if (node.node.type === 'collection') {
      context.lineWidth = 2 / view.k
      context.strokeStyle = dark ? '#141218' : '#ffffff'
      context.stroke()
      const icon = node.node.icon
      // An emoji, not an icon name.
      if (icon && !/^[a-z-]+$/.test(icon) && node.radius * view.k >= 8) {
        context.font = `${node.radius * 1.1}px sans-serif`
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(icon, node.x ?? 0, (node.y ?? 0) + node.radius * 0.08)
      }
    }
  }

  context.font = `${12 / view.k}px ui-sans-serif, system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'top'
  context.fillStyle = dark ? '#d4d4d8' : '#3f3f46'
  for (const node of s.nodes) {
    const shown = lit
      ? lit.has(node.id)
      : view.k > 1.4 || (node.node.type === 'collection' && view.k > 0.5)
    if (!shown) continue
    context.globalAlpha = node === hovered ? 1 : 0.85
    const label = node.node.label.length > 40 ? `${node.node.label.slice(0, 39)}…` : node.node.label
    context.fillText(label, node.x ?? 0, (node.y ?? 0) + node.radius + 3 / view.k)
  }
  context.globalAlpha = 1
}

function clamp(value: number, low: number, high: number) {
  return Math.min(Math.max(value, low), high)
}

function local(element: HTMLElement, event: { clientX: number; clientY: number }) {
  const box = element.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

function toWorld(view: View, point: { x: number; y: number }) {
  return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k }
}

/** The node under a point on the canvas, the topmost one first. */
function hit(s: S, point: { x: number; y: number }) {
  const world = toWorld(s.view, point)
  for (let i = s.nodes.length - 1; i >= 0; i--) {
    const node = s.nodes[i]
    const reach = node.radius + 3 / s.view.k
    if (Math.hypot((node.x ?? 0) - world.x, (node.y ?? 0) - world.y) <= reach) return node
  }
  return null
}

/** Zooms and pans so every node is in view. */
function fit(s: S) {
  const { width, height } = s.size
  if (!width || !s.nodes.length) return
  const xs = s.nodes.map((node) => node.x ?? 0)
  const ys = s.nodes.map((node) => node.y ?? 0)
  const [left, right] = [Math.min(...xs) - 40, Math.max(...xs) + 40]
  const [top, bottom] = [Math.min(...ys) - 40, Math.max(...ys) + 40]
  const k = clamp(Math.min(width / (right - left), height / (bottom - top)), MIN_ZOOM, 2)
  s.view = {
    k,
    x: width / 2 - ((left + right) / 2) * k,
    y: height / 2 - ((top + bottom) / 2) * k,
  }
}
