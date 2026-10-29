import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Board, Layout } from './api'
import { emptyLayout, toFlowNodes } from './layout'
import type { LayoutDraft } from './saver'
import { BoardSession } from './session'

const viewport = { x: 0, y: 0, zoom: 1 }

function board(): Board {
  const layout: Layout = {
    ...emptyLayout(),
    nodes: [{ id: 'a', type: 'item', item: 'i', x: 0, y: 0, w: 280, h: null, parent: null }],
  }
  return {
    id: 'b',
    title: 'Board',
    item_count: 1,
    revision: 1,
    created_at: '',
    updated_at: '',
    layout,
    items: [],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function memoryDrafts(initial?: LayoutDraft) {
  const store = new Map<string, LayoutDraft>(initial ? [['b', initial]] : [])
  return {
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, draft: LayoutDraft) => void store.set(key, draft),
    remove: (key: string) => void store.delete(key),
  }
}

function setUp(draft?: LayoutDraft) {
  const save = vi.fn(async (layout: Layout, revision: number) => ({
    revision: revision + 1,
    layout,
    updated_at: '',
  }))
  const onSaved = vi.fn()
  const start = board()
  const session = new BoardSession(start, {
    save,
    onSaveState: () => {},
    onSaved,
    drafts: memoryDrafts(draft),
  })
  return { save, onSaved, session, nodes: toFlowNodes(start.layout) }
}

describe('BoardSession', () => {
  it('saves only changes worth saving', async () => {
    const { save, session, nodes } = setUp()
    expect(session.commit(nodes, viewport)).toBe(false)
    // Panning alone is not a change.
    expect(session.commit(nodes, { x: 50, y: 0, zoom: 2 })).toBe(false)
    const moved = [{ ...nodes[0], position: { x: 100, y: 0 } }]
    expect(session.commit(moved, viewport)).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].nodes[0].x).toBe(100)
  })

  it('undo shows and saves the previous layout', async () => {
    const { save, session, nodes } = setUp()
    session.commit([{ ...nodes[0], position: { x: 100, y: 0 } }], viewport)
    await vi.advanceTimersByTimeAsync(1000)
    expect(session.saver.status).toBe('saved')

    const undone = session.travel('undo', viewport)
    expect(undone?.[0].position).toEqual({ x: 0, y: 0 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(2)
    const [layout, revision] = save.mock.calls[1]
    expect([layout.nodes, revision]).toEqual([board().layout.nodes, 2])
    expect(session.travel('undo', viewport)).toBeUndefined()
    expect(session.travel('redo', viewport)?.[0].position).toEqual({ x: 100, y: 0 })
  })

  it('tells when a save placed new items', async () => {
    const { onSaved, session, nodes } = setUp()
    session.place()
    session.commit([...nodes, { ...nodes[0], id: 'b', data: { itemId: 'j' } }], viewport)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved.mock.calls[0][1]).toBe(true)
    session.commit(nodes, viewport)
    await vi.advanceTimersByTimeAsync(1000)
    expect(onSaved).toHaveBeenCalledTimes(2)
    expect(onSaved.mock.calls[1][1]).toBe(false)
  })

  it('undoing and redoing quickly saves once, or not at all if back where it was', async () => {
    const { save, session, nodes } = setUp()
    session.commit([{ ...nodes[0], position: { x: 100, y: 0 } }], viewport)
    session.commit([{ ...nodes[0], position: { x: 200, y: 0 } }], viewport)
    session.travel('undo', viewport)
    session.travel('undo', viewport)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()

    session.travel('redo', viewport)
    session.travel('redo', viewport)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].nodes[0].x).toBe(200)
  })

  it('brings back a draft as an undoable change, and saves it', async () => {
    const draft = {
      ...board().layout,
      nodes: [
        { ...board().layout.nodes[0], x: 300 },
        { id: 'c', type: 'item' as const, item: 'k', x: 0, y: 400, w: 280, h: null, parent: null },
      ],
    }
    const { save, onSaved, session } = setUp({ layout: draft, base: 1 })
    expect(session.initialNodes.map((node) => node.position.x)).toEqual([300, 0])
    expect(session.history.canUndo).toBe(true)
    session.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save.mock.calls[0][0]).toEqual(draft)
    // A card placed while offline still organizes its item.
    expect(onSaved.mock.calls[0][1]).toBe(true)
    expect(session.travel('undo', viewport)?.[0].position).toEqual({ x: 0, y: 0 })
  })
})
