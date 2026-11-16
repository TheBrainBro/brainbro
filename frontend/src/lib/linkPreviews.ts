/*
 * Links a note shows as a card or an embed, written `[text](url "card")` or
 * `[text](url "embed")`: the title is the choice, so elsewhere the Markdown
 * still reads as a plain link. The card's details and image are the server's
 * copy (items/api `NoteLinkPreview`): opening the note never tells the site.
 * An embed does load the site, which is why it is chosen link by link.
 *
 * Posts from X run X's own script, so they never play in the app's page: they
 * play in a page of the embed host, an origin of its own (apps.public.embeds),
 * which says how tall the post is (`sizeEmbeddedPosts`).
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

const X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/web|i|\w{1,15})\/status\/(\d{1,20})/

// What a post's frame may do: run X's script in the embed host's origin, and
// open the post's links in a new tab.
const POST_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox'

const EMBED_HEIGHT = 'brainbro:embed-height'
const MAX_POST_HEIGHT = 4000

/** The embed host the server names in index.html; null without one. */
function embedUrl() {
  return document.querySelector<HTMLMetaElement>('meta[name="embed-url"]')?.content || null
}

/** The embed host's page of the post on X at `url`, or null. */
function postSrc(url: string) {
  const host = embedUrl()
  const match = X_POST.exec(url)
  return host && match ? `${host}/x/${match[1]}` : null
}

/** Where `url` can play inside the note, or null when it can't be embedded. */
export function embedSrc(url: string): string | null {
  const post = postSrc(url)
  if (post) return post
  for (const { pattern, src } of PROVIDERS) {
    const match = pattern.exec(url)
    if (match) return src(match[1])
  }
  return null
}

/** Only players from known sites ever make it into a note's HTML. */
export function isEmbedSrc(src: string) {
  const host = embedUrl()
  return EMBED_ORIGINS.some((origin) => src.startsWith(origin)) || Boolean(host && src.startsWith(`${host}/x/`))
}

/**
 * Embedded posts take the height their page reports: only from the frame
 * it came from, and only a number. Listens for as long as the app runs.
 */
export function sizeEmbeddedPosts() {
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: unknown; height?: unknown } | null
    if (data?.type !== EMBED_HEIGHT || typeof data.height !== 'number' || !Number.isFinite(data.height)) return
    for (const frame of document.querySelectorAll<HTMLIFrameElement>('.link-embed-post iframe')) {
      if (frame.contentWindow !== event.source) continue
      if (new URL(frame.src).origin !== event.origin) return
      frame.style.height = `${Math.min(Math.max(data.height, 0), MAX_POST_HEIGHT)}px`
      return
    }
  })
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
  const title = preview?.title || label || url
  const post = postSrc(url)
  if (post) {
    return (
      `<span class="link-embed link-embed-post"><iframe src="${escape(post)}" title="${escape(title)}" loading="lazy" ` +
      `sandbox="${POST_SANDBOX}" referrerpolicy="strict-origin-when-cross-origin"></iframe></span>`
    )
  }
  const src = embedSrc(url)
  if (!src) return linkCardHtml(url, label, preview)
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
