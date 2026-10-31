import { useQueryClient } from '@tanstack/react-query'

import { useFeedback, type ToastAction } from '../ui/feedback'
import {
  collectionsKey,
  itemsKey,
  triageItems,
  type Item,
  type TriageAction,
  type TriagePayload,
} from './api'

function count(n: number) {
  return n === 1 ? '1 item' : `${n} items`
}

/** What a toast says once a triage action is done. */
export function triageMessage(action: TriageAction, n: number, into?: string) {
  switch (action) {
    case 'archive':
      return `Archived ${count(n)}`
    case 'inbox':
      return `Moved ${count(n)} to the inbox`
    case 'organize':
      return into ? `Organized ${count(n)} into ${into}` : `Organized ${count(n)}`
    case 'unorganize':
      return into ? `Took ${count(n)} out of ${into}` : `Took ${count(n)} out of the collection`
    case 'delete':
      return `Deleted ${count(n)}`
  }
}

/**
 * The triage calls that put items back where they were before an archive or
 * a move to the inbox, or null when that can't be done: organizing adds
 * collections (taking them away again is another matter) and deleting is
 * for good.
 */
export function undoTriage(action: TriageAction, before: Item[]): TriagePayload[] | null {
  if (action !== 'archive' && action !== 'inbox') return null
  const groups = new Map<string, TriagePayload>()
  for (const item of before) {
    let payload: TriagePayload
    if (item.status === 'organized') {
      // Organizing needs a collection; these are already in theirs.
      if (!item.collections.length) return null
      payload = { ids: [], action: 'organize', collections: item.collections }
    } else {
      payload = { ids: [], action: item.status === 'archived' ? 'archive' : 'inbox' }
    }
    const key = `${payload.action}:${payload.collections?.join(',') ?? ''}`
    const group = groups.get(key) ?? payload
    group.ids.push(item.id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/**
 * The toast's Undo for `undoTriage`'s calls. It doesn't depend on the
 * component that showed it, which may be gone by then (an archived note
 * goes back to the list).
 */
export function useUndoAction() {
  const queryClient = useQueryClient()
  const { toast } = useFeedback()
  return (payloads: TriagePayload[] | null): ToastAction[] | undefined => {
    if (!payloads) return undefined
    return [
      {
        label: 'Undo',
        onClick: async () => {
          try {
            for (const payload of payloads) await triageItems(payload)
          } catch (error) {
            toast({ message: (error as Error).message, tone: 'error' })
          }
          queryClient.invalidateQueries({ queryKey: itemsKey })
          queryClient.invalidateQueries({ queryKey: collectionsKey })
        },
      },
    ]
  }
}
