/*
 * Links a note shows as a card or an embed, written `[text](url "card")` or
 * `[text](url "embed")`: the title is the choice, so elsewhere the Markdown
 * still reads as a plain link. The card's details and image are the server's
 * copy (items/api `NoteLinkPreview`): opening the note never tells the site.
 * An embed does load the site, which is why it is chosen link by link.
 */

import { t } from '../i18n/i18n'

export type LinkView = 'link' | 'card' | 'embed'

/** The preview the server keeps of a card or embed link (see items/api). */
export type LinkPreview = {
  status: string
  title: string
  description: string
  site_name: string
  image_url: string | null
}

const PROVIDERS: { pattern: RegExp; src: (id: string) => string }[] = [
  {
    pattern: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/,
    // The privacy-enhanced player: no cookies until it plays.
    src: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
  {
    pattern: /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)/,
    src: (id) => `https://player.vimeo.com/video/${id}`,
  },
  {
    pattern: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([0-9a-f]{32})/,
    src: (id) => `https://www.loom.com/embed/${id}`,
  },
]

const EMBED_ORIGINS = ['https://www.youtube-nocookie.com/', 'https://player.vimeo.com/', 'https://www.loom.com/embed/']

/** Where `url` can play inside the note, or null when it can't be embedded. */
export function embedSrc(url: string): string | null {
  for (const { pattern, src } of PROVIDERS) {
    const match = pattern.exec(url)
    if (match) return src(match[1])
  }
  return null
}

/** Only players from known sites ever make it into a note's HTML. */
export function isEmbedSrc(src: string) {
  return EMBED_ORIGINS.some((origin) => src.startsWith(origin))
}

function escape(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A card: title, description and site, with the stored image. */
export function linkCardHtml(url: string, label: string, preview?: LinkPreview | null) {
  const status = preview?.status ?? 'pending'
  const title = preview?.title || (label && label !== url ? label : url)
  const description =
    preview?.description || (status === 'pending' ? t('markdown.fetchingPreview') : '')
  const site = preview?.site_name || hostname(url)
  return (
    `<a class="link-card" data-status="${escape(status)}" href="${escape(url)}" target="_blank" rel="noopener noreferrer">` +
    `<span class="link-card-text">` +
    `<span class="link-card-title">${escape(title)}</span>` +
    (description ? `<span class="link-card-description">${escape(description)}</span>` : '') +
    `<span class="link-card-site">${escape(site)}</span>` +
    `</span>` +
    (preview?.image_url ? `<img class="link-card-image" src="${escape(preview.image_url)}" alt="" loading="lazy">` : '') +
    `</a>`
  )
}

/** The site's own player, for links that have one; a card for the rest. */
export function linkEmbedHtml(url: string, label: string, preview?: LinkPreview | null) {
  const src = embedSrc(url)
  if (!src) return linkCardHtml(url, label, preview)
  const title = preview?.title || label || url
  return (
    `<span class="link-embed"><iframe src="${escape(src)}" title="${escape(title)}" loading="lazy" ` +
    `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`
  )
}

/** The line a link is written as, for each way of showing it. */
export function linkLine(url: string, label: string, view: LinkView) {
  const text = label || url
  if (view === 'link') return text === url ? url : `[${text}](${url})`
  return `[${text}](${url} "${view}")`
}
