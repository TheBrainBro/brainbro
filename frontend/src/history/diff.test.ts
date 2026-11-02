import { describe, expect, it } from 'vitest'

import type { Layout } from '../boards/api'
import { emptyLayout } from '../boards/layout'
import { aroundChanges, boardChanges, textDiff } from './diff'

describe('textDiff', () => {
  it('marks the lines added and removed', () => {
    expect(textDiff('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'added', text: 'd' },
    ])
  })
})

describe('aroundChanges', () => {
  it('keeps a few lines around each change and counts the rest', () => {
    const before = Array.from({ length: 10 }, (_, line) => `line ${line}`).join('\n')
    const after = before.replace('line 5', 'line five')

    const shown = aroundChanges(textDiff(before, after), 1)

    expect(shown).toEqual([
      { type: 'gap', count: 4 },
      { type: 'same', text: 'line 4' },
      { type: 'removed', text: 'line 5' },
      { type: 'added', text: 'line five' },
      { type: 'same', text: 'line 6' },
      { type: 'gap', count: 3 },
    ])
  })
})

function layout(fields: Partial<Layout>): Layout {
  return { ...emptyLayout(), ...fields }
}

const box = { w: null, h: null, parent: null }

describe('boardChanges', () => {
  it('says what was added, removed, edited and moved', () => {
    const before = layout({
      nodes: [
        { id: 'a', type: 'item', item: 'i1', x: 0, y: 0, ...box },
        { id: 'b', type: 'item', item: 'i2', x: 0, y: 0, ...box },
        { id: 's', type: 'sticky', text: 'Buy milk', color: '', x: 0, y: 0, ...box },
      ],
      groups: [{ id: 'g', title: 'Week', color: '', x: 0, y: 0, w: 10, h: 10, parent: null }],
    })
    const after = layout({
      nodes: [
        { id: 'a', type: 'item', item: 'i1', x: 50, y: 0, ...box },
        { id: 's', type: 'sticky', text: 'Buy oat milk', color: '', x: 0, y: 0, ...box },
        { id: 'c', type: 'item', item: 'i3', x: 0, y: 0, ...box },
        { id: 'p', type: 'stroke', points: [], color: '', width: 2, x: 0, y: 0, ...box },
      ],
      edges: [{ id: 'e', source: 'a', target: 'c', label: '' }],
    })
    const names: Record<string, string> = { i1: 'Plan', i2: 'Old idea', i3: 'New idea' }

    const changes = boardChanges(
      { title: 'Trip', layout: before },
      { title: 'Japan', layout: after },
      (id) => `“${names[id]}”`,
    )

    expect(changes).toEqual([
      { type: 'changed', text: 'Renamed from “Trip”' },
      { type: 'changed', text: 'Edited a sticky note: “Buy oat milk”' },
      { type: 'added', text: 'Added “New idea”' },
      { type: 'removed', text: 'Removed “Old idea”' },
      { type: 'removed', text: 'Removed frame “Week”' },
      { type: 'changed', text: 'Moved 1 card' },
      { type: 'added', text: 'Added 1 connection' },
      { type: 'added', text: 'Drew 1 line' },
    ])
  })

  it('has nothing to say about the same board', () => {
    const same = { title: 'Trip', layout: emptyLayout() }

    expect(boardChanges(same, same, String)).toEqual([])
  })
})
