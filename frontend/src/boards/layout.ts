import type { Node, Viewport } from '@xyflow/react'

import type { ItemKind } from '../items/api'
import type { Layout, LayoutNode } from './api'

/** What a node carries: only the item's id. The card reads the item from the cache. */
export type ItemNodeData = { itemId: string }

export type ItemFlowNode = Node<ItemNodeData, 'item'>

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

export function toFlowNodes(layout: Layout): ItemFlowNode[] {
  return layout.nodes.map((node) => ({
    id: node.id,
    type: 'item',
    position: { x: node.x, y: node.y },
    width: node.w ?? undefined,
    height: node.h ?? undefined,
    parentId: node.parent ?? undefined,
    data: { itemId: node.item },
  }))
}

/**
 * The layout to store for what is on the canvas. Groups and edges come from
 * `base` as they are until the canvas edits them, so nothing a newer client
 * saved is lost.
 */
export function toLayout(nodes: ItemFlowNode[], viewport: Viewport, base: Layout): Layout {
  return {
    ...base,
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    nodes: nodes.map(
      (node): LayoutNode => ({
        id: node.id,
        type: 'item',
        item: node.data.itemId,
        x: round(node.position.x),
        y: round(node.position.y),
        w: node.width ? round(node.width) : null,
        h: node.height ? round(node.height) : null,
        parent: node.parentId ?? null,
      }),
    ),
  }
}

/** The same positions and sizes: nothing worth saving changed. */
export function sameNodes(a: Layout, b: Layout) {
  return JSON.stringify(a.nodes) === JSON.stringify(b.nodes)
}

export function newNodeId() {
  return `n-${crypto.randomUUID()}`
}

// Sub-pixel positions are noise in the stored JSON.
function round(value: number) {
  return Math.round(value * 10) / 10
}

type Box = { x: number; y: number; width: number; height: number }

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
export function freeSpot(center: { x: number; y: number }, width: number, nodes: ItemFlowNode[]) {
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
