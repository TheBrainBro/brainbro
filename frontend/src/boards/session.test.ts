import { describe, expect, it, vi } from 'vitest'

import type { Board, Layout } from './api'
import { emptyLayout, toFlowNodes } from './layout'
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

function setUp() {
  const save = vi.fn(async (layout: Layout, revision: number) => ({
    revision: revision + 1,
    layout,
    updated_at: '',
  }))
  const onSaved = vi.fn()
  const start = board()
  const session = new BoardSession(start, { save, onSaveState: () => {}, onSaved })
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
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].nodes[0].x).toBe(100)
  })

  it('undo shows and saves the previous layout', async () => {
    const { save, session, nodes } = setUp()
    session.commit([{ ...nodes[0], position: { x: 100, y: 0 } }], viewport)
    await vi.waitFor(() => expect(session.saver.snapshot.status).toBe('saved'))

    const undone = session.travel('undo', viewport)
    expect(undone?.[0].position).toEqual({ x: 0, y: 0 })
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]).toEqual([expect.objectContaining({ nodes: board().layout.nodes }), 2])
    expect(session.travel('undo', viewport)).toBeUndefined()
    expect(session.travel('redo', viewport)?.[0].position).toEqual({ x: 100, y: 0 })
  })

  it('tells when a save placed new items', async () => {
    const { onSaved, session, nodes } = setUp()
    session.place()
    session.commit([...nodes, { ...nodes[0], id: 'b', data: { itemId: 'j' } }], viewport)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(onSaved.mock.calls[0][1]).toBe(true)
    session.commit(nodes, viewport)
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2))
    expect(onSaved.mock.calls[1][1]).toBe(false)
  })
})
