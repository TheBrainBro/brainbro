import { diffLines } from 'diff'

import type { Layout, LayoutGroup, LayoutNode } from '../boards/api'
import { t } from '../i18n/i18n'

export type DiffLine = { type: 'same' | 'added' | 'removed'; text: string }
/** Unchanged lines left out, around the changes. */
export type DiffGap = { type: 'gap'; count: number }

/** `before` to `after`, line by line. */
export function textDiff(before: string, after: string): DiffLine[] {
  return diffLines(before, after).flatMap((part) => {
    const type = part.added ? 'added' : part.removed ? 'removed' : 'same'
    // The last line's newline ends it: no empty line after it.
    return part.value.replace(/\n$/, '').split('\n').map((text) => ({ type, text }))
  })
}

/** Only the changes and `context` lines around each; the rest becomes gaps. */
export function aroundChanges(lines: DiffLine[], context = 2): (DiffLine | DiffGap)[] {
  const near = lines.map(() => false)
  lines.forEach((line, index) => {
    if (line.type === 'same') return
    for (let at = Math.max(index - context, 0); at <= index + context && at < lines.length; at++) {
      near[at] = true
    }
  })
  const shown: (DiffLine | DiffGap)[] = []
  lines.forEach((line, index) => {
    if (near[index]) shown.push(line)
    else if (shown.at(-1)?.type === 'gap') (shown.at(-1) as DiffGap).count++
    else shown.push({ type: 'gap', count: 1 })
  })
  return shown
}

export type BoardChange = { type: 'added' | 'removed' | 'changed'; text: string }

const QUOTE_LENGTH = 40

function quote(text: string) {
  const line = text.trim().split('\n')[0]
  return `“${line.length > QUOTE_LENGTH ? `${line.slice(0, QUOTE_LENGTH)}…` : line}”`
}

function byId<T extends { id: string }>(list: T[]) {
  return new Map(list.map((entry) => [entry.id, entry]))
}

function frameName(frame: LayoutGroup) {
  return frame.title ? t('boardChanges.frameNamed', { title: quote(frame.title) }) : t('boardChanges.frame')
}

function moved(a: LayoutNode, b: LayoutNode) {
  return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.parent !== b.parent
}

/**
 * What changed on a board from `before` to `after`, in words: cards, sticky
 * notes and frames added, removed or edited, and how many were moved,
 * connected or drawn. `label` names an item card's item.
 */
export function boardChanges(
  before: { title: string; layout: Layout },
  after: { title: string; layout: Layout },
  label: (itemId: string) => string,
): BoardChange[] {
  const changes: BoardChange[] = []
  if (before.title !== after.title) {
    changes.push({ type: 'changed', text: t('boardChanges.renamedFrom', { title: quote(before.title) }) })
  }
  const then = byId(before.layout.nodes)
  const now = byId(after.layout.nodes)
  let movedCount = 0
  let drawn = 0
  let erased = 0
  for (const node of after.layout.nodes) {
    const old = then.get(node.id)
    if (old) {
      if (node.type === 'sticky' && old.type === 'sticky' && node.text !== old.text) {
        changes.push({ type: 'changed', text: t('boardChanges.editedSticky', { text: quote(node.text) }) })
      }
      if (node.type !== 'stroke' && moved(old, node)) movedCount++
    } else if (node.type === 'item') {
      changes.push({ type: 'added', text: t('boardChanges.added', { what: label(node.item) }) })
    } else if (node.type === 'sticky') {
      changes.push({ type: 'added', text: t('boardChanges.addedSticky', { text: quote(node.text) }) })
    } else {
      drawn++
    }
  }
  for (const node of before.layout.nodes) {
    if (now.has(node.id)) continue
    if (node.type === 'item') {
      changes.push({ type: 'removed', text: t('boardChanges.removed', { what: label(node.item) }) })
    } else if (node.type === 'sticky') {
      changes.push({ type: 'removed', text: t('boardChanges.removedSticky', { text: quote(node.text) }) })
    } else {
      erased++
    }
  }

  const framesThen = byId(before.layout.groups)
  const framesNow = byId(after.layout.groups)
  for (const frame of after.layout.groups) {
    const old = framesThen.get(frame.id)
    if (!old) changes.push({ type: 'added', text: t('boardChanges.added', { what: frameName(frame) }) })
    else if (old.title !== frame.title) {
      changes.push({
        type: 'changed',
        text: t('boardChanges.renamedFrame', { frame: frameName(old), title: quote(frame.title) }),
      })
    }
  }
  for (const frame of before.layout.groups) {
    if (!framesNow.has(frame.id)) {
      changes.push({ type: 'removed', text: t('boardChanges.removed', { what: frameName(frame) }) })
    }
  }

  const edgesThen = new Set(before.layout.edges.map((edge) => edge.id))
  const edgesNow = new Set(after.layout.edges.map((edge) => edge.id))
  const connected = after.layout.edges.filter((edge) => !edgesThen.has(edge.id)).length
  const disconnected = before.layout.edges.filter((edge) => !edgesNow.has(edge.id)).length

  const counts: [number, BoardChange['type'], string][] = [
    [movedCount, 'changed', t('boardChanges.moved', { count: movedCount })],
    [connected, 'added', t('boardChanges.connected', { count: connected })],
    [disconnected, 'removed', t('boardChanges.disconnected', { count: disconnected })],
    [drawn, 'added', t('boardChanges.drew', { count: drawn })],
    [erased, 'removed', t('boardChanges.erased', { count: erased })],
  ]
  for (const [count, type, text] of counts) if (count) changes.push({ type, text })
  return changes
}
