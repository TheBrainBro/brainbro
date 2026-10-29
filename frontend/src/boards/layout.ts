import type { Edge, Node, Viewport } from '@xyflow/react'

import type { ItemKind } from '../items/api'
import type { EdgeArrow, EdgeStroke, Layout, LayoutEdge, LayoutGroup, LayoutNode } from './api'

export type StickyNodeData = { text: string; color: string; editing?: boolean }

export type StickyFlowNode = Node<StickyNodeData, 'sticky'>

export type StrokeNodeData = { points: [number, number][]; color: string; width: number }

export type StrokeFlowNode = Node<StrokeNodeData, 'stroke'>

/**
 * What a node carries: the item's id (the card reads the item from the
 * cache), and whether its note is being edited in place, which is never saved.
 */
export type ItemNodeData = { itemId: string; editing?: boolean }

export type ItemFlowNode = Node<ItemNodeData, 'item'>

/** A group (a frame on the canvas): its cards are its children in React Flow. */
export type FrameNodeData = { title: string; color: string; editing?: boolean }

export type FrameFlowNode = Node<FrameNodeData, 'frame'>

/** A group is dragged by its title bar; inside it, a drag selects. */
export const FRAME_HANDLE = '.frame-handle'

export type BoardNode = ItemFlowNode | FrameFlowNode | StickyFlowNode | StrokeFlowNode

export type EdgeData = {
  label: string
  arrow: EdgeArrow
  stroke: EdgeStroke
  color: string
  /** Its label is being typed; never saved. */
  editing?: boolean
}

export type BoardEdge = Edge<EdgeData, 'floating'>

/** What the canvas shows: cards and frames, and the edges between them. */
export type Scene = { nodes: BoardNode[]; edges: BoardEdge[] }

/** Width a card gets when it is placed; it grows downwards with its content. */
export const DEFAULT_WIDTH: Record<ItemKind, number> = {
  note: 280,
  link: 340,
  image: 260,
  file: 280,
}

export function emptyLayout(): Layout {
  return { schema_version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], groups: [], edges: [] }
}

export const isFrame = (node: BoardNode): node is FrameFlowNode => node.type === 'frame'
export const isItem = (node: BoardNode): node is ItemFlowNode => node.type === 'item'
export const isSticky = (node: BoardNode): node is StickyFlowNode => node.type === 'sticky'

function edgeData(edge: LayoutEdge): EdgeData {
  // Older layouts may lack the looks: the server's defaults.
  return {
    label: edge.label ?? '',
    arrow: edge.arrow ?? 'end',
    stroke: edge.stroke ?? 'solid',
    color: edge.color ?? '',
  }
}

export function toScene(layout: Layout): Scene {
  const frames = layout.groups.map(
    (group): FrameFlowNode => ({
      id: group.id,
      type: 'frame',
      position: { x: group.x, y: group.y },
      width: group.w,
      height: group.h,
      parentId: group.parent ?? undefined,
      dragHandle: FRAME_HANDLE,
      data: { title: group.title, color: group.color },
    }),
  )
  const items = layout.nodes.map((node): BoardNode => {
    const box = {
      id: node.id,
      position: { x: node.x, y: node.y },
      width: node.w ?? undefined,
      height: node.h ?? undefined,
      parentId: node.parent ?? undefined,
    }
    switch (node.type) {
      case 'item':
        return { ...box, type: 'item', data: { itemId: node.item } }
      case 'sticky':
        return { ...box, type: 'sticky', data: { text: node.text, color: node.color } }
      case 'stroke':
        return {
          ...box,
          type: 'stroke',
          data: { points: node.points, color: node.color, width: node.width },
        }
    }
  })
  const edges = layout.edges.map(
    (edge): BoardEdge => ({
      id: edge.id,
      type: 'floating',
      source: edge.source,
      target: edge.target,
      data: edgeData(edge),
    }),
  )
  return { nodes: ordered([...frames, ...items]), edges }
}

/** The layout to store for what is on the canvas; anything else in `base` is kept as it is. */
export function toLayout(scene: Scene, viewport: Viewport, base: Layout): Layout {
  const nodes: LayoutNode[] = []
  const groups: LayoutGroup[] = []
  for (const node of scene.nodes) {
    const box = {
      x: round(node.position.x),
      y: round(node.position.y),
      parent: node.parentId ?? null,
    }
    if (isFrame(node)) {
      groups.push({
        id: node.id,
        title: node.data.title,
        color: node.data.color,
        ...box,
        w: round(size(node).width),
        h: round(size(node).height),
      })
      continue
    }
    const sized = {
      id: node.id,
      ...box,
      w: node.width ? round(node.width) : null,
      h: node.height ? round(node.height) : null,
    }
    if (node.type === 'item') nodes.push({ ...sized, type: 'item', item: node.data.itemId })
    else if (node.type === 'sticky') {
      nodes.push({ ...sized, type: 'sticky', text: node.data.text, color: node.data.color })
    } else {
      const { points, color, width } = node.data
      nodes.push({ ...sized, type: 'stroke', points, color, width })
    }
  }
  return {
    ...base,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    nodes,
    groups,
    edges: scene.edges.map(
      (edge): LayoutEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.data?.label ?? '',
        arrow: edge.data?.arrow ?? 'end',
        stroke: edge.data?.stroke ?? 'solid',
        color: edge.data?.color ?? '',
      }),
    ),
  }
}

/** JSON with object keys sorted: the server (Postgres jsonb) stores them in its own order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const fields = entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`)
    return `{${fields.join(',')}}`
  }
  return JSON.stringify(value)
}

/** The same nodes, groups and edges: nothing worth saving changed (the viewport alone isn't). */
export function sameContent(a: Layout, b: Layout) {
  return (
    a === b ||
    canonical([a.nodes, a.groups, a.edges.map(normalEdge)]) ===
      canonical([b.nodes, b.groups, b.edges.map(normalEdge)])
  )
}

// An edge stored before it had looks is the same as one with the defaults.
function normalEdge(edge: LayoutEdge): LayoutEdge {
  return { id: edge.id, source: edge.source, target: edge.target, ...edgeData(edge) }
}

export function newNodeId() {
  return `n-${crypto.randomUUID()}`
}

// Sub-pixel positions are noise in the stored JSON.
function round(value: number) {
  return Math.round(value * 10) / 10
}

export type Box = { x: number; y: number; width: number; height: number }

/** What placing needs to know of a card already there (or about to be). */
export type Placed = Pick<BoardNode, 'position' | 'width' | 'height' | 'measured'>

// Assumed for cards not measured yet (just placed, or off screen).
const UNMEASURED_HEIGHT = 160
const GAP = 24

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width + GAP &&
    b.x < a.x + a.width + GAP &&
    a.y < b.y + b.height + GAP &&
    b.y < a.y + a.height + GAP
  )
}

/**
 * Where to put a new card of `width` near `center` without covering others:
 * the closest free spot on rings of growing size around it.
 */
export function freeSpot(center: { x: number; y: number }, width: number, nodes: Placed[]) {
  const boxes = nodes.map((node) => ({
    ...node.position,
    width: node.measured?.width ?? node.width ?? DEFAULT_WIDTH.note,
    height: node.measured?.height ?? node.height ?? UNMEASURED_HEIGHT,
  }))
  const start = { x: center.x - width / 2, y: center.y - UNMEASURED_HEIGHT / 2 }
  const step = { x: width + GAP, y: UNMEASURED_HEIGHT / 2 }
  for (let ring = 0; ring < 20; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const box = {
          x: start.x + dx * step.x,
          y: start.y + dy * step.y,
          width,
          height: UNMEASURED_HEIGHT,
        }
        if (!boxes.some((other) => overlaps(box, other))) return { x: box.x, y: box.y }
      }
    }
  }
  return start
}

// Where the pointer holds a card dropped on the canvas: near its top, in the middle.
const GRAB_Y = 24

/** Where a card of `width` dropped at `point` goes: under the pointer, or the closest free spot. */
export function dropSpot(point: { x: number; y: number }, width: number, nodes: Placed[]) {
  return freeSpot({ x: point.x, y: point.y - GRAB_Y + UNMEASURED_HEIGHT / 2 }, width, nodes)
}

/** Where several cards dropped together go: the first under the pointer, the rest below it. */
export function dropSpots(point: { x: number; y: number }, widths: number[], nodes: Placed[]) {
  const taken = [...nodes]
  return widths.map((width, index) => {
    const below = { x: point.x, y: point.y + index * (UNMEASURED_HEIGHT + GAP) }
    const position = dropSpot(below, width, taken)
    taken.push({ position, width })
    return position
  })
}

/** What an item dragged onto the canvas carries (from the Add items panel). */
export const ITEM_DRAG_TYPE = 'application/x-brain-item'

/** The size a node takes up, measured if it has been rendered. */
export function size(node: Placed) {
  return {
    width: node.measured?.width ?? node.width ?? DEFAULT_WIDTH.note,
    height: node.measured?.height ?? node.height ?? UNMEASURED_HEIGHT,
  }
}

// Around the cards a new group gets (its title sits above it).
const FRAME_PADDING = 32

const FRAME_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#71717a']

/** The colors a group or an edge can take; '' is the default. */
export const PALETTE = ['', ...FRAME_COLORS]

function byId(nodes: BoardNode[]) {
  return new Map(nodes.map((node) => [node.id, node]))
}

/** Where a node is on the canvas (its position is relative to its group). */
export function absolute(nodes: BoardNode[], node: BoardNode) {
  const index = byId(nodes)
  let { x, y } = node.position
  for (let parent = index.get(node.parentId!); parent; parent = index.get(parent.parentId!)) {
    x += parent.position.x
    y += parent.position.y
  }
  return { x, y }
}

function absoluteBox(nodes: BoardNode[], node: BoardNode): Box {
  return { ...absolute(nodes, node), ...size(node) }
}

function depth(index: Map<string, BoardNode>, node: BoardNode) {
  let count = 0
  for (let parent = index.get(node.parentId!); parent; parent = index.get(parent.parentId!)) count++
  return count
}

/** Groups before what they hold (React Flow needs parents first), outer ones first. */
export function ordered(nodes: BoardNode[]) {
  const index = byId(nodes)
  const frames = nodes
    .filter(isFrame)
    .map((node) => ({ node, depth: depth(index, node) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ node }) => node as BoardNode)
  return [...frames, ...nodes.filter((node) => !isFrame(node))]
}

/** The node's id and every id inside it, at any depth. */
export function family(nodes: BoardNode[], id: string) {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        grew = true
      }
    }
  }
  return ids
}

function inside(point: { x: number; y: number }, box: Box) {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  )
}

function contains(outer: Box, inner: Box) {
  return (
    inside(inner, outer) && inside({ x: inner.x + inner.width, y: inner.y + inner.height }, outer)
  )
}

/** The innermost group under `point`, leaving out `excluded` (what is being moved). */
export function frameAt(
  nodes: BoardNode[],
  point: { x: number; y: number },
  excluded = new Set<string>(),
) {
  const index = byId(nodes)
  let found: FrameFlowNode | undefined
  let foundDepth = -1
  for (const node of nodes) {
    if (!isFrame(node) || excluded.has(node.id)) continue
    const level = depth(index, node)
    if (level > foundDepth && inside(point, absoluteBox(nodes, node))) {
      found = node
      foundDepth = level
    }
  }
  return found
}

/** Moves a node into a group (or out to the canvas) where it is now on screen. */
export function reparent(nodes: BoardNode[], id: string, parentId: string | undefined) {
  const index = byId(nodes)
  const node = index.get(id)
  if (!node || node.parentId === parentId) return nodes
  const at = absolute(nodes, node)
  const parent = parentId ? index.get(parentId) : undefined
  const origin = parent ? absolute(nodes, parent) : { x: 0, y: 0 }
  const moved = { ...node, parentId, position: { x: at.x - origin.x, y: at.y - origin.y } }
  return ordered(nodes.map((candidate) => (candidate.id === id ? moved : candidate)))
}

/** Puts each node dropped (dragged and let go) in the group its middle is over, or out of one. */
export function settle(nodes: BoardNode[], ids: string[]) {
  let next = nodes
  for (const id of ids) {
    const node = next.find((candidate) => candidate.id === id)
    if (!node) continue
    const box = absoluteBox(next, node)
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // Several dragged together keep the group they share (one of them may be it).
    if (node.parentId && ids.includes(node.parentId)) continue
    next = reparent(next, id, frameAt(next, middle, family(next, id))?.id)
  }
  return next
}

function newFrame(id: string, box: Box, parentId: string | undefined, nodes: BoardNode[]) {
  const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined
  const origin = parent ? absolute(nodes, parent) : { x: 0, y: 0 }
  return {
    id,
    type: 'frame',
    position: { x: box.x - origin.x, y: box.y - origin.y },
    width: box.width,
    height: box.height,
    parentId,
    dragHandle: FRAME_HANDLE,
    selected: true,
    data: { title: '', color: '' },
  } satisfies FrameFlowNode
}

function withFrame(nodes: BoardNode[], frame: FrameFlowNode, children: string[]) {
  let next: BoardNode[] = [
    frame,
    ...nodes.map((node) => (node.selected ? { ...node, selected: false } : node)),
  ]
  for (const id of children) next = reparent(next, id, frame.id)
  return ordered(next)
}

/**
 * A new group around the nodes in `ids` (the outermost ones, if a group and
 * what it holds are both there), inside the group they all share, if any.
 */
export function groupNodes(nodes: BoardNode[], ids: string[], frameId: string) {
  const chosen = new Set(ids)
  const index = byId(nodes)
  const picked = nodes.filter((node) => {
    if (!chosen.has(node.id)) return false
    for (let parent = index.get(node.parentId!); parent; parent = index.get(parent.parentId!)) {
      if (chosen.has(parent.id)) return false
    }
    return true
  })
  if (picked.length === 0) return undefined
  const boxes = picked.map((node) => absoluteBox(nodes, node))
  const left = Math.min(...boxes.map((box) => box.x)) - FRAME_PADDING
  const top = Math.min(...boxes.map((box) => box.y)) - FRAME_PADDING
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + FRAME_PADDING
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + FRAME_PADDING
  const shared = picked.every((node) => node.parentId === picked[0].parentId)
  const box = { x: left, y: top, width: right - left, height: bottom - top }
  const frame = newFrame(frameId, box, shared ? picked[0].parentId : undefined, nodes)
  return withFrame(nodes, frame, picked.map((node) => node.id))
}

/** A group drawn on the canvas: it takes in what lies wholly inside it. */
export function drawFrame(nodes: BoardNode[], box: Box, frameId: string) {
  const parent = nodes
    .filter((node) => isFrame(node) && contains(absoluteBox(nodes, node), box))
    .reduce<BoardNode | undefined>(
      (inner, node) => (!inner || family(nodes, inner.id).has(node.id) ? node : inner),
      undefined,
    )
  const children = nodes.filter(
    (node) => node.parentId === parent?.id && contains(box, absoluteBox(nodes, node)),
  )
  const frame = newFrame(frameId, box, parent?.id, nodes)
  return withFrame(nodes, frame, children.map((node) => node.id))
}

/** Takes a group away and leaves what it held where it is. */
export function ungroup(nodes: BoardNode[], frameId: string) {
  const frame = nodes.find((node) => node.id === frameId)
  if (!frame || !isFrame(frame)) return nodes
  let next = nodes
  for (const node of nodes) {
    if (node.parentId === frameId) next = reparent(next, node.id, frame.parentId)
  }
  return next.filter((node) => node.id !== frameId)
}

/** Edges whose ends are both still there. */
export function connected(nodes: BoardNode[], edges: BoardEdge[]) {
  const ids = new Set(nodes.map((node) => node.id))
  const kept = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))
  return kept.length === edges.length ? edges : kept
}

/** Where cards are on the canvas, for placing new ones among them (groups don't get in the way). */
export function obstacles(nodes: BoardNode[]): Placed[] {
  return nodes
    .filter((node) => !isFrame(node))
    .map((node) => ({ position: absolute(nodes, node), ...size(node) }))
}

/** Sticky note colors, pastel; '' is the default yellow. */
export const STICKY_DEFAULT = '#fef08a'
export const STICKY_COLORS = ['', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa', '#e4e4e7']
export const STICKY_SIZE = 200

/** A new sticky note centered on `point`, ready to type in. */
export function newSticky(point: { x: number; y: number }, id: string): StickyFlowNode {
  return {
    id,
    type: 'sticky',
    position: { x: point.x - STICKY_SIZE / 2, y: point.y - STICKY_SIZE / 2 },
    width: STICKY_SIZE,
    height: STICKY_SIZE,
    selected: true,
    data: { text: '', color: '', editing: true },
  }
}

/** A pen line from points on the canvas: boxed, with its points relative to the box. */
export function newStroke(
  points: { x: number; y: number }[],
  pen: { color: string; width: number },
  id: string,
): StrokeFlowNode | undefined {
  if (points.length < 2) return undefined
  // The box leaves room for the line's own thickness.
  const pad = pen.width / 2 + 1
  const left = Math.min(...points.map((point) => point.x)) - pad
  const top = Math.min(...points.map((point) => point.y)) - pad
  const right = Math.max(...points.map((point) => point.x)) + pad
  const bottom = Math.max(...points.map((point) => point.y)) + pad
  return {
    id,
    type: 'stroke',
    position: { x: round(left), y: round(top) },
    width: round(right - left),
    height: round(bottom - top),
    data: {
      points: points.map((point): [number, number] => [
        round(point.x - left),
        round(point.y - top),
      ]),
      color: pen.color,
      width: pen.width,
    },
  }
}

/** A smooth SVG path through the points (curves between their midpoints). */
export function strokePath(points: [number, number][]) {
  if (points.length < 3) return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')}`
  let path = `M${points[0][0]} ${points[0][1]}`
  for (let index = 1; index < points.length - 1; index++) {
    const [x, y] = points[index]
    const [nextX, nextY] = points[index + 1]
    path += ` Q${x} ${y} ${(x + nextX) / 2} ${(y + nextY) / 2}`
  }
  const [lastX, lastY] = points[points.length - 1]
  return `${path} L${lastX} ${lastY}`
}
