import type { QueryClient } from '@tanstack/react-query'

import { boardKey, boardsKey } from '../boards/api'
import { collectionsKey, itemsKey } from '../items/api'
import { TAB_ID } from '../lib/api'

/**
 * What changed in this user's BrainBro, as the server tells it (backend
 * apps.events): items by id, boards by id with their new revision. Even with
 * neither, lists changed (collections, order). `tab` is the tab whose request
 * changed it; `by`, the assistant that did (an open note shows it live, with
 * its cursor, instead).
 */
export type Change = {
  items: string[]
  boards: Record<string, number>
  tab: string
  by: string
}

// An assistant organizing a dozen items sends a burst: refetch once it settles.
const SETTLE_MS = 300

/**
 * Keeps what is on screen up to date with changes made elsewhere: other tabs
 * and devices, assistants, background work. Changed queries are invalidated,
 * so the ones on screen refetch and the rest do when shown again. Returns
 * what stops it.
 */
export function followChanges(
  queryClient: QueryClient,
  open?: (url: string) => EventSource,
) {
  // Browsers without it (and tests) just don't follow.
  if (!open && typeof EventSource === 'undefined') return () => {}
  const source = open ? open('/api/events/') : new EventSource('/api/events/')
  let items = new Set<string>()
  let boards = new Set<string>()
  let lists = false
  // Reconnected: whatever happened meanwhile was missed.
  let everything = false
  let connected = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function refetch() {
    if (everything) {
      for (const queryKey of [itemsKey, collectionsKey, boardsKey, ['graph']]) {
        queryClient.invalidateQueries({ queryKey })
      }
    } else if (lists) {
      const changed = items
      queryClient.invalidateQueries({
        queryKey: itemsKey,
        predicate: (query) =>
          query.queryKey[1] !== 'detail' || changed.has(query.queryKey[2] as string),
      })
      queryClient.invalidateQueries({ queryKey: collectionsKey })
      queryClient.invalidateQueries({ queryKey: ['graph'] })
      queryClient.invalidateQueries({ queryKey: boardsKey, exact: true })
      for (const id of boards) queryClient.invalidateQueries({ queryKey: boardKey(id) })
    }
    items = new Set()
    boards = new Set()
    lists = false
    everything = false
  }

  function soon() {
    clearTimeout(timer)
    timer = setTimeout(refetch, SETTLE_MS)
  }

  source.onopen = () => {
    if (connected) {
      everything = true
      soon()
    }
    connected = true
  }
  source.onmessage = (event: MessageEvent<string>) => {
    const change = JSON.parse(event.data) as Change
    if (change.tab === TAB_ID) return
    for (const id of change.items) items.add(id)
    for (const id of Object.keys(change.boards)) boards.add(id)
    lists = true
    soon()
  }

  return () => {
    clearTimeout(timer)
    source.close()
  }
}
