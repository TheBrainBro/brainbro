import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../lib/api'
import type { Board, Layout, SavedLayout } from './api'
import { emptyLayout } from './layout'
import { LayoutSaver } from './saver'

function layoutAt(x: number): Layout {
  return {
    ...emptyLayout(),
    nodes: [{ id: 'a', type: 'item', item: 'i', x, y: 0, w: null, h: null, parent: null }],
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

describe('LayoutSaver', () => {
  it('saves with the revision and moves on to the next one', async () => {
    const save = vi.fn(async (layout: Layout, revision: number) => saved(revision + 1, layout))
    const onChange = vi.fn()
    const saver = new LayoutSaver(3, { save, onChange })

    saver.save(layoutAt(1))
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('saved'))
    saver.save(layoutAt(2))
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))

    expect(save.mock.calls.map(([, revision]) => revision)).toEqual([3, 4])
    expect(saver.currentRevision).toBe(5)
    expect(onChange).toHaveBeenCalledWith({ status: 'saving' })
  })

  it('sends one request at a time and only the latest layout', async () => {
    const first = deferred<SavedLayout>()
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (layout: Layout) => saved(3, layout))
    const saver = new LayoutSaver(1, { save, onChange: () => {} })

    saver.save(layoutAt(1))
    saver.save(layoutAt(2))
    saver.save(layoutAt(3))
    expect(save).toHaveBeenCalledTimes(1)

    first.resolve(saved(2, layoutAt(1)))
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('saved'))
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual([layoutAt(3), 2])
  })

  it('stops on a conflict until a side is picked', async () => {
    const theirs = { revision: 7, layout: layoutAt(9) } as Board
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(412, theirs))
      .mockImplementation(async (layout: Layout) => saved(8, layout))
    const saver = new LayoutSaver(1, { save, onChange: () => {} })

    saver.save(layoutAt(1))
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('conflict'))
    expect(saver.snapshot.theirs).toBe(theirs)
    saver.save(layoutAt(2))
    expect(save).toHaveBeenCalledTimes(1)

    saver.resolve('mine')
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('saved'))
    expect(save.mock.calls[1]).toEqual([layoutAt(2), 7])
  })

  it('drops our layout when theirs is taken', async () => {
    const theirs = { revision: 7, layout: layoutAt(9) } as Board
    const save = vi.fn().mockRejectedValueOnce(new ApiError(412, theirs))
    const saver = new LayoutSaver(1, { save, onChange: () => {} })

    saver.save(layoutAt(1))
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('conflict'))
    expect(saver.resolve('theirs')).toBe(theirs)
    expect(saver.snapshot.status).toBe('saved')
    expect(saver.currentRevision).toBe(7)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed layout to retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (layout: Layout) => saved(2, layout))
    const saver = new LayoutSaver(1, { save, onChange: () => {} })

    saver.save(layoutAt(1))
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('error'))
    saver.retry()
    await vi.waitFor(() => expect(saver.snapshot.status).toBe('saved'))
    expect(save.mock.calls[1]).toEqual([layoutAt(1), 1])
  })
})
