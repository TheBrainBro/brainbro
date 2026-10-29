import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../lib/api'
import type { Board, Layout, SavedLayout } from './api'
import { emptyLayout } from './layout'
import { LayoutSaver, type LayoutDraft, type LayoutSaverOptions } from './saver'

function layoutAt(x: number, count = 1): Layout {
  return {
    ...emptyLayout(),
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `n${index}`,
      type: 'item' as const,
      item: `i${index}`,
      x,
      y: index * 200,
      w: null,
      h: null,
      parent: null,
    })),
  }
}

function boardAt(revision: number, layout = layoutAt(0)): Board {
  return {
    id: 'b1',
    title: 'Board',
    item_count: layout.nodes.length,
    revision,
    created_at: '',
    updated_at: '',
    layout,
    items: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const saved = (revision: number, layout: Layout): SavedLayout => ({
  revision,
  layout,
  updated_at: '',
})

function memoryDrafts() {
  const store = new Map<string, LayoutDraft>()
  return {
    store,
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, draft: LayoutDraft) => void store.set(key, draft),
    remove: (key: string) => void store.delete(key),
  }
}

let drafts: ReturnType<typeof memoryDrafts>
let save: ReturnType<typeof vi.fn<LayoutSaverOptions['save']>>

function makeSaver(board = boardAt(3), overrides: Partial<LayoutSaverOptions> = {}) {
  return new LayoutSaver(board, { save, onChange: () => {}, drafts, ...overrides })
}

beforeEach(() => {
  vi.useFakeTimers()
  drafts = memoryDrafts()
  save = vi.fn<LayoutSaverOptions['save']>(async (layout, revision) => saved(revision + 1, layout))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LayoutSaver', () => {
  it('saves changes in a row once they stop, with the revision it started from', async () => {
    const statuses: string[] = []
    const saver = makeSaver(boardAt(3), { onChange: (state) => statuses.push(state.status) })
    saver.save(layoutAt(1))
    await vi.advanceTimersByTimeAsync(600)
    saver.save(layoutAt(2))
    await vi.advanceTimersByTimeAsync(600)
    saver.save(layoutAt(3))
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(layoutAt(3), 3, { keepalive: false })
    expect(saver.currentRevision).toBe(4)
    expect(statuses).toEqual(['unsaved', 'saving', 'saved'])
  })

  it('still saves every few seconds while changes keep coming', async () => {
    const saver = makeSaver()
    for (let x = 1; x <= 12; x++) {
      saver.save(layoutAt(x))
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toEqual(layoutAt(10))
  })

  it('sends one request at a time and only the latest layout', async () => {
    const first = deferred<SavedLayout>()
    save.mockReturnValueOnce(first.promise)
    const saver = makeSaver(boardAt(1))

    saver.save(layoutAt(1))
    await vi.advanceTimersByTimeAsync(1000)
    saver.save(layoutAt(2))
    saver.save(layoutAt(3))
    await saver.flush()
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve(saved(2, layoutAt(1)))
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual([layoutAt(3), 2, { keepalive: false }])
    expect(saver.status).toBe('saved')
  })

  it('sends nothing when the layout is back to what was saved (undo, redo)', async () => {
    const saver = makeSaver()
    saver.save(layoutAt(5))
    saver.save(layoutAt(0))
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('keeps a draft and retries with backoff while offline', async () => {
    save
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const saver = makeSaver()

    saver.save(layoutAt(7))
    expect(drafts.store.get('b1')).toEqual({ layout: layoutAt(7), base: 3 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('offline')

    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(3)
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('retries at once when the connection comes back', async () => {
    save.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const saver = makeSaver()
    saver.save(layoutAt(7))
    await vi.advanceTimersByTimeAsync(1000)
    saver.retryNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(saver.status).toBe('saved')
  })

  it('tries once more on leaving, then leaves the rest to the draft', async () => {
    save.mockRejectedValue(new TypeError('Failed to fetch'))
    const saver = makeSaver()
    saver.save(layoutAt(7))
    saver.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(drafts.store.get('b1')).toEqual({ layout: layoutAt(7), base: 3 })
  })

  it('does not retry an invalid layout, but shows why', async () => {
    save.mockRejectedValue(new ApiError(400, { detail: 'Too many nodes.', path: 'nodes' }))
    const saver = makeSaver()
    saver.save(layoutAt(7))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.snapshot).toEqual({ status: 'error', error: 'Too many nodes.' })
  })

  it('stops on a conflict, keeps editing locally, and saves over theirs when told', async () => {
    const theirs = boardAt(7, layoutAt(9))
    save.mockRejectedValueOnce(new ApiError(412, theirs))
    const saver = makeSaver(boardAt(1))

    saver.save(layoutAt(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('conflict')
    expect(saver.snapshot.theirs).toBe(theirs)
    saver.save(layoutAt(2))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(drafts.store.get('b1')?.layout).toEqual(layoutAt(2))

    saver.resolve('mine')
    await vi.advanceTimersByTimeAsync(0)
    expect(save.mock.calls[1]).toEqual([layoutAt(2), 7, { keepalive: false }])
    expect(saver.status).toBe('saved')
  })

  it('drops our layout when theirs is taken', async () => {
    const theirs = boardAt(7, layoutAt(9))
    save.mockRejectedValueOnce(new ApiError(412, theirs))
    const saver = makeSaver(boardAt(1))

    saver.save(layoutAt(1))
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.resolve('theirs')).toBe(theirs)
    expect(saver.status).toBe('saved')
    expect(saver.currentRevision).toBe(7)
    expect(drafts.store.size).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('restores a draft made on the current revision and saves it', async () => {
    drafts.set('b1', { layout: layoutAt(4), base: 3 })
    const saver = makeSaver(boardAt(3))
    expect(saver.restoreDraft()).toEqual(layoutAt(4))
    expect(saver.status).toBe('unsaved')
    saver.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledWith(layoutAt(4), 3, { keepalive: false })
    expect(drafts.store.size).toBe(0)
  })

  it('treats a draft made on an older revision as a conflict', () => {
    drafts.set('b1', { layout: layoutAt(4), base: 2 })
    const board = boardAt(3)
    const saver = makeSaver(board)
    expect(saver.restoreDraft()).toEqual(layoutAt(4))
    expect(saver.snapshot).toEqual({ status: 'conflict', theirs: board })
  })

  it('forgets a draft the server already has (saved as the tab closed)', () => {
    drafts.set('b1', { layout: layoutAt(4), base: 2 })
    const saver = makeSaver(boardAt(3, layoutAt(4)))
    expect(saver.restoreDraft()).toBeUndefined()
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('moves the draft onto the new revision when changes came in during a save', async () => {
    const first = deferred<SavedLayout>()
    save.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}))
    const saver = makeSaver(boardAt(3))
    saver.save(layoutAt(1))
    await vi.advanceTimersByTimeAsync(1000)
    saver.save(layoutAt(2))
    first.resolve(saved(4, layoutAt(1)))
    await vi.advanceTimersByTimeAsync(0)
    // The second save is still on its way: a reload now must not see a conflict.
    expect(save).toHaveBeenCalledTimes(2)
    expect(drafts.store.get('b1')).toEqual({ layout: layoutAt(2), base: 4 })
  })

  it('saves with keepalive as the page closes, unless the layout is too big for it', async () => {
    const small = makeSaver()
    small.save(layoutAt(1))
    await small.flush({ keepalive: true })
    expect(save).toHaveBeenLastCalledWith(layoutAt(1), 3, { keepalive: true })

    const big = makeSaver()
    big.save(layoutAt(1, 1000))
    await big.flush({ keepalive: true })
    expect(save).toHaveBeenLastCalledWith(layoutAt(1, 1000), 3, { keepalive: false })
  })
})
