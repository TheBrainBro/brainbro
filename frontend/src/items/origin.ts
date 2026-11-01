import { timeAgo } from '../lib/time'
import type { Item } from './api'

/** Whether an app (an assistant or a token) made the item or last edited it. */
export function byAssistant(item: Item) {
  return Boolean(item.created_by || item.edited_by)
}

/**
 * Who made and last edited it, when an app had a hand in it: "Edited by
 * Claude, 2 hours ago", "Added by ChatGPT, 3 days ago". Null for items only
 * the user touched.
 */
export function originText(item: Item, now = Date.now()) {
  if (!byAssistant(item)) return null
  const edited = item.edited_at
    ? `Edited by ${item.edited_by || 'you'}, ${timeAgo(item.edited_at, now)}`
    : null
  if (!item.created_by) return edited
  const added = `Added by ${item.created_by}`
  return edited ? `${added} · ${edited}` : `${added}, ${timeAgo(item.created_at, now)}`
}
