import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { boardKey, boardsKey } from '../boards/api'
import { collectionsKey, itemKey, itemsKey } from '../items/api'
import { TAB_ID } from '../lib/api'
import { FakeEventSource } from '../test/eventSource'
import { followChanges } from './changes'

let queryClient: QueryClient
let source: FakeEventSource
let stop: () => void

const KEYS = {
  inbox: [...itemsKey, { status: 'inbox' }],
  note: itemKey('n1'),
  otherNote: itemKey('n2'),
  collections: collectionsKey,
  graph: ['graph'],
  boards: boardsKey,
  board: boardKey('b1'),
  otherBoard: boardKey('b2'),
}

function stale() {
  return Object.entries(KEYS)
    .filter(([, queryKey]) => queryClient.getQueryState(queryKey)?.isInvalidated)
    .map(([name]) => name)
}

beforeEach(() => {
  vi.useFakeTimers()
  queryClient = new QueryClient()
  for (const queryKey of Object.values(KEYS)) queryClient.setQueryData(queryKey, {})
  stop = followChanges(queryClient, (url) => new FakeEventSource(url) as unknown as EventSource)
  source = FakeEventSource.last!
  source.open()
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

describe('followChanges', () => {
  it('listens to the server’s change stream', () => {
    expect(source.url).toBe('/api/events/')
  })

  it('refetches lists and what changed, once a burst settles', async () => {
    source.send({ items: ['n1'] })
    source.send({ boards: { b1: 4 } })
    expect(stale()).toEqual([])

    await vi.advanceTimersByTimeAsync(300)
    expect(stale()).toEqual(['inbox', 'note', 'collections', 'graph', 'boards', 'board'])
  })

  it('skips what this tab changed itself', async () => {
    source.send({ items: ['n1'], tab: TAB_ID })
    await vi.advanceTimersByTimeAsync(300)
    expect(stale()).toEqual([])
  })

  it('refetches everything after reconnecting, for what it missed', async () => {
    source.open()
    await vi.advanceTimersByTimeAsync(300)
    expect(stale()).toEqual(Object.keys(KEYS))
  })

  it('closes the stream when stopped', () => {
    stop()
    expect(source.closed).toBe(true)
  })
})
