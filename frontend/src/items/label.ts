import type { Item } from './api'

/** A one-line name for an item, for lists and zoomed-out cards. */
export function itemLabel(item: Item) {
  if (item.title) return item.title
  if (item.kind === 'link') return item.metadata.title || item.url
  if (item.kind === 'note') {
    const line = item.body.split('\n').find((text) => text.trim())
    return line?.replace(/^[#>*\-+\s]+|\[[ xX]\]\s*/g, '').trim() || 'Empty note'
  }
  return item.metadata.filename || (item.kind === 'image' ? 'Image' : 'File')
}
