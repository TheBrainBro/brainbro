import type { Item, ItemKind } from './api'

/** What each kind of item is called, in lists and on cards. */
export const KIND_LABEL: Record<ItemKind, string> = {
  note: 'Note',
  link: 'Link',
  image: 'Image',
  file: 'File',
  album: 'Album',
}

/** A one-line name for an item, for lists and zoomed-out cards. */
export function itemLabel(item: Item) {
  if (item.title) return item.title
  // An image's or album's caption says more than its file name.
  const caption = (item.kind === 'image' || item.kind === 'album') && item.body.trim()
  if (caption) return caption.split('\n')[0].trim()
  if (item.kind === 'link') return item.metadata.title || item.url
  if (item.kind === 'note') {
    const line = item.body.split('\n').find((text) => text.trim())
    return line?.replace(/^[#>*\-+\s]+|\[[ xX]\]\s*/g, '').trim() || 'Empty note'
  }
  if (item.kind === 'album') {
    return `${item.album_items?.length ?? 0} images`
  }
  return item.metadata.filename || (item.kind === 'image' ? 'Image' : 'File')
}
