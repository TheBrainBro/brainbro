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

const note = (body: string): SavedNote => ({ id: 'n1', body })

let drafts: ReturnType<typeof memoryDrafts>
let statuses: string[]
let create: ReturnType<typeof vi.fn<SaverOptions<SavedNote>['create']>>

function makeSaver(overrides: Partial<SaverOptions<SavedNote>> = {}) {
  return new NoteSaver({
    create,
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
  create = vi.fn<SaverOptions<SavedNote>['create']>(async (body) => note(body))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NoteSaver', () => {
  it('creates the note only once it has text, after the typing stops', async () => {
    const onCreated = vi.fn()
    const saver = makeSaver({ onCreated })

    saver.edit('  \n')
    await vi.advanceTimersByTimeAsync(800)
    expect(create).not.toHaveBeenCalled()

    saver.edit('# Idea')
    await vi.advanceTimersByTimeAsync(799)
    expect(saver.status).toBe('unsaved')
    await vi.advanceTimersByTimeAsync(1)
    expect(create).toHaveBeenCalledWith('# Idea')
    expect(onCreated).toHaveBeenCalledWith(note('# Idea'))
    expect(saver.noteId).toBe('n1')
    expect(saver.status).toBe('saved')
    expect(drafts.store.has(NEW_NOTE)).toBe(false)
  })

  it('saves nothing more once created, but keeps what is typed for the live note', async () => {
    const first = deferred<SavedNote>()
    create.mockReturnValueOnce(first.promise)
    const saver = makeSaver()

    saver.edit('a')
    await vi.advanceTimersByTimeAsync(800)
    // Typed while it was being created.
    saver.edit('ab')
    first.resolve(note('a'))
    await vi.runAllTimersAsync()
    saver.edit('abc')
    await vi.runAllTimersAsync()

    expect(create).toHaveBeenCalledTimes(1)
    expect(saver.body).toBe('abc')
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('keeps a draft and retries with backoff while offline', async () => {
    create
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const saver = makeSaver()

    saver.edit('offline text')
    await vi.advanceTimersByTimeAsync(800)
    expect(saver.status).toBe('offline')
    expect(drafts.store.get(NEW_NOTE)).toEqual({ body: 'offline text' })

    await vi.advanceTimersByTimeAsync(2000)
    expect(create).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3999)
    expect(create).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(create).toHaveBeenCalledTimes(3)
    expect(saver.status).toBe('saved')
    expect(drafts.store.size).toBe(0)
  })

  it('retries at once when the connection comes back', async () => {
    create.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const saver = makeSaver()
    saver.edit('b')
    await vi.advanceTimersByTimeAsync(800)
    saver.retryNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(saver.status).toBe('saved')
  })

  it('does not retry client errors, but shows them', async () => {
    create.mockRejectedValue(new ApiError(400, { text: ['Too long.'] }))
    const saver = makeSaver()
    saver.edit('b')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(create).toHaveBeenCalledTimes(1)
    expect(saver.status).toBe('error')
  })

  it('restores the draft of a new note and creates it', async () => {
    drafts.set(NEW_NOTE, { body: 'from before' })
    const saver = makeSaver()
    saver.restoreDraft()
    expect(saver.body).toBe('from before')
    expect(saver.status).toBe('unsaved')

    saver.resume()
    await vi.advanceTimersByTimeAsync(800)
    expect(create).toHaveBeenCalledWith('from before')
  })
})
