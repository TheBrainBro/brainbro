import { t } from '../i18n/i18n'
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
  let edited: string | null = null
  if (item.edited_at) {
    const when = timeAgo(item.edited_at, now)
    edited = item.edited_by
      ? t('items.editedBy', { name: item.edited_by, when })
      : t('items.editedByYou', { when })
  }
  if (!item.created_by) return edited
  if (edited) return `${t('items.addedBy', { name: item.created_by })} · ${edited}`
  return t('items.addedByWhen', { name: item.created_by, when: timeAgo(item.created_at, now) })
}
