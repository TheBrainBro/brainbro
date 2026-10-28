import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../lib/api'
import { NEW_NOTE, NoteSaver, type Draft, type SavedNote, type SaverOptions } from './saver'

function memoryDrafts() {
  const store = new Map<string, Draft>()
  return {
    store,
    get: (key: string) => store.get(key) ?? null,
    set: (key: string, draft: Draft) => void store.set(key, draft),
    remove: (key: string) => void store.delete(key),
  }
}

/** A request the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const note = (body: string, version = `v-${body}`): SavedNote => ({ id: 'n1', body, version })

let drafts: ReturnType<typeof memoryDrafts>
let statuses: string[]
let update: ReturnType<typeof vi.fn<SaverOptions<SavedNote>['update']>>

function makeSaver(initial: SavedNote | null, overrides: Partial<SaverOptions<SavedNote>> = {}) {
  return new NoteSaver(initial, {
    create: vi.fn(async (body: string) => note(body)),
    update,
    onChange: (state) => statuses.push(state.status),
    drafts,
    debounceMs: 800,
    ...overrides,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  drafts = memoryDrafts()
  statuses = []
  update = vi.fn<SaverOptions<SavedNote>['update']>(async (_id, body) => note(body))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NoteSaver', () => {
  it('saves once, after the typing stops, with the version it started from', async () => {
    const saver = makeSaver(note('a'))
    saver.edit('ab')
    await vi.advanceTimersByTimeAsync(500)
    saver.edit('abc')
    await vi.advanceTimersByTimeAsync(799)
    expect(saver.status).toBe('unsaved')

    await vi.advanceTimersByTimeAsync(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('n1', 'abc', 'v-a', { keepalive: false })
    expect(saver.status).toBe('saved')
    expect(statuses).toEqual(['unsaved', 'saving', 'saved'])
    expect(drafts.store.size).toBe(0)
  })

  it('sends edits made during a save in one follow-up request', async () => {
    const first = deferred<SavedNote>()
    const update = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (_id, body) => note(body))
    const saver = makeSaver(note('a'), { update })

    saver.edit('ab')
    await vi.advanceTimersByTimeAsync(800)
    saver.edit('abc')
    saver.edit('abcd')
    await saver.flush()
    expect(update).toHaveBeenCalledTimes(1)

    first.resolve(note('ab'))
    await vi.runAllTimersAsync()
    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenLastCalledWith('n1', 'abcd', 'v-ab', { keepalive: false })
    expect(saver.status).toBe('saved')
  })

  it('creates a new note only once it has text, then updates it', async () => {
    const create = vi.fn(async (body: string) => note(body))
    const onSaved = vi.fn()
    const saver = makeSaver(null, { create, onSaved })

    saver.edit('  \n')
    await vi.advanceTimersByTimeAsync(800)
    expect(create).not.toHaveBeenCalled()

    saver.edit('# Idea')
    await vi.advanceTimersByTimeAsync(800)
    expect(create).toHaveBeenCalledWith('# Idea')
    expect(onSaved).toHaveBeenCalledWith(note('# Idea'), true)
    expect(saver.noteId).toBe('n1')
    expect(drafts.store.has(NEW_NOTE)).toBe(false)

    saver.edit('# Idea\n\nmore')
    await vi.advanceTimersByTimeAsync(800)
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('n1', '# Idea\n\nmore', 'v-# Idea', {
      keepalive: false,
    })
  })

  it('keeps a draft and retries with backoff while offline', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (_id, body) => note(body))
    const saver = makeSaver(note('a'), { update })

    saver.edit('offline text')
    await vi.advanceTimersByTimeAsync(800)
    expect(saver.status).toBe('offline')
    expect(drafts.store.get('n1')).toEqual({ body: 'offline text', base: 'v-a' })

    await vi.advanceTimersByTimeAsync(2000)
    expect(update).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(update).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(update).toHaveBeenCalledTimes(3)
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('retries at once when the connection comes back', async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (_id, body) => note(body))
    const saver = makeSaver(note('a'), { update })
    saver.edit('b')
    await vi.advanceTimersByTimeAsync(800)
    saver.retryNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(saver.status).toBe('saved')
  })

  it('does not retry client errors, but shows them', async () => {
    const update = vi.fn().mockRejectedValue(new ApiError(400, { body: ['Too long.'] }))
    const saver = makeSaver(note('a'), { update })
    saver.edit('b')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(update).toHaveBeenCalledTimes(1)
    expect(saver.status).toBe('error')
  })

  it('stops on a conflict until a side is picked', async () => {
    const theirs = note('from the other tab', 'v-other')
    const update = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(412, theirs))
      .mockImplementation(async (_id, body) => note(body))
    const saver = makeSaver(note('a'), { update })

    saver.edit('mine')
    await vi.advanceTimersByTimeAsync(800)
    expect(saver.status).toBe('conflict')
    saver.edit('mine, still typing')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(update).toHaveBeenCalledTimes(1)

    saver.resolve('mine')
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenLastCalledWith('n1', 'mine, still typing', 'v-other', {
      keepalive: false,
    })
    expect(saver.status).toBe('saved')
  })

  it('can drop its text for the other side of a conflict', async () => {
    const theirs = note('theirs', 'v-theirs')
    const saver = makeSaver(note('a'), {
      update: vi.fn().mockRejectedValue(new ApiError(412, theirs)),
    })
    saver.edit('mine')
    await vi.advanceTimersByTimeAsync(800)
    saver.resolve('theirs')
    expect(saver.body).toBe('theirs')
    expect(saver.generation).toBe(1)
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('restores a draft written on top of the current text and saves it', async () => {
    drafts.set('n1', { body: 'unsaved before reload', base: 'v-a' })
    const saver = makeSaver(note('a'))
    saver.restoreDraft()
    expect(saver.body).toBe('unsaved before reload')
    expect(saver.status).toBe('unsaved')
    expect(update).not.toHaveBeenCalled()
    saver.resume()
    await vi.advanceTimersByTimeAsync(800)
    expect(update).toHaveBeenCalledWith('n1', 'unsaved before reload', 'v-a', { keepalive: false })
    expect(saver.status).toBe('saved')
  })

  it('treats a draft over text that changed since as a conflict', () => {
    drafts.set('n1', { body: 'old draft', base: 'v-older' })
    const saver = makeSaver(note('a'))
    saver.restoreDraft()
    expect(saver.status).toBe('conflict')
    expect(saver.body).toBe('old draft')
  })

  it('saves with keepalive when the page is closing', async () => {
    const saver = makeSaver(note('a'))
    saver.edit('b')
    saver.dispose({ keepalive: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(update).toHaveBeenCalledWith('n1', 'b', 'v-a', { keepalive: true })
  })
})
