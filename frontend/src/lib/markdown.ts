import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import abbr from 'markdown-it-abbr'
import container from 'markdown-it-container'
import deflist from 'markdown-it-deflist'
import { full as emoji } from 'markdown-it-emoji'
import footnote from 'markdown-it-footnote'
import ins from 'markdown-it-ins'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'

import {
  resolveWikilink,
  wikilinkLabel,
  WIKILINK,
  type NoteTitleIndex,
} from '../notes/wikilinks'
import { isEmbedSrc, linkCardHtml, linkEmbedHtml, type LinkPreview } from './linkPreviews'

export { default as emojiByName } from 'markdown-it-emoji/lib/data/full.mjs'
export { default as emoticonsByName } from 'markdown-it-emoji/lib/data/shortcuts.mjs'

/** `::: name` blocks the notes understand; anything else stays text. */
export const CONTAINERS = ['note', 'info', 'tip', 'warning', 'danger'] as const

/*
 * One Markdown dialect for the whole app, the one markdown-it's demo shows:
 * CommonMark + GFM tables and strikethrough, linkify, typographer and the
 * emoji, sub, sup, ins, mark, footnote, deflist, abbr and container plugins.
 * Raw HTML is off: tags in a note are shown as text, never parsed.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true })
  .use(emoji)
  .use(sub)
  .use(sup)
  .use(ins)
  .use(mark)
  .use(footnote)
  .use(deflist)
  .use(abbr)
CONTAINERS.forEach((name) => md.use(container, name))

// Links leave the app.
md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, idx, options)
}

// `[[Title]]` links another note (notes/wikilinks); `![[…]]` embeds aren't links.
const WIKILINK_AT = new RegExp(WIKILINK.source, 'y')

md.inline.ruler.before('link', 'wikilink', (state, silent) => {
  const { src, pos } = state
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false
  if (src.charCodeAt(pos - 1) === 0x21) return false
  WIKILINK_AT.lastIndex = pos
  const match = WIKILINK_AT.exec(src)
  if (!match) return false
  if (!silent) {
    const token = state.push('wikilink', '', 0)
    token.meta = { target: match[1], heading: match[2] ?? null, text: match[3] ?? null }
  }
  state.pos += match[0].length
  return true
})

md.renderer.rules.wikilink = (tokens, idx, _options, env) => {
  const link = tokens[idx].meta as { target: string; heading: string | null; text: string | null }
  const label = md.utils.escapeHtml(wikilinkLabel(link))
  const notes = (env as RenderEnv | undefined)?.notes
  if (!notes) return `<span class="wikilink">${label}</span>`
  const id = resolveWikilink(notes, link.target)
  if (!id) {
    return `<span class="wikilink wikilink-unresolved" title="No note with this title">${label}</span>`
  }
  const note = md.utils.escapeHtml(id)
  return `<a class="wikilink" href="/notes/${note}" data-note="${note}">${label}</a>`
}

/** A copy the app keeps of an image in a note (see items/api `NoteImage`). */
type StoredImage = { status: string; url: string | null }

/**
 * The key a note's image is stored under: its link destination as written
 * (`<a b.png>`, backslash escapes) read the way markdown-it reads it, as the
 * server does.
 */
export function imageKey(destination: string) {
  const bare = /^<.*>$/s.test(destination) ? destination.slice(1, -1) : destination
  return md.normalizeLink(md.utils.unescapeAll(bare))
}

// Images are never loaded from where the Markdown points: that would tell
// any site when a note is open. The app's stored copy is shown instead,
// looked up by `src`; until there is one, the alt text stands in.
md.renderer.rules.image = (tokens, idx, _options, env) => {
  const token = tokens[idx]
  const alt = md.utils.escapeHtml(token.children?.map((child) => child.content).join('') ?? '')
  const stored = (env as RenderEnv | undefined)?.images?.[token.attrGet('src') ?? '']
  if (stored?.url) {
    return `<img class="markdown-img" src="${md.utils.escapeHtml(stored.url)}" alt="${alt}" loading="lazy">`
  }
  const status = stored ? ` data-status="${md.utils.escapeHtml(stored.status)}"` : ''
  const title = stored?.status === 'failed' ? ' title="Couldn\'t load this image"' : ''
  return `<span class="markdown-image"${status}${title}>${alt || 'image'}</span>`
}

// GFM task items: `- [ ] text` gets a checkbox carrying its source line.
const TASK = /^\[([ xX])\][ \t]/

md.core.ruler.after('inline', 'task_lists', (state) => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const item = tokens[i - 2]
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open') continue
    if (item.type !== 'list_item_open' || !item.map) continue
    const match = TASK.exec(inline.content)
    const first = inline.children?.[0]
    if (!match || first?.type !== 'text' || !first.content.startsWith(match[0])) continue
    first.content = first.content.slice(match[0].length)
    const box = new state.Token('task_checkbox', 'input', 0)
    box.meta = { checked: match[1] !== ' ', line: item.map[0] }
    inline.children!.unshift(box)
    item.attrJoin('class', 'task-list-item')
  }
})

md.renderer.rules.task_checkbox = (tokens, idx, _options, env) => {
  const tasks = (env as RenderEnv | undefined)?.tasks
  const { checked, line } = tokens[idx].meta as { checked: boolean; line: number }
  const label = checked ? 'Done' : 'To do'
  return (
    `<input type="checkbox" data-task-line="${line}" aria-label="${label}"` +
    `${checked ? ' checked' : ''}${tasks ? '' : ' disabled'}>`
  )
}

// A paragraph that is only a `[text](url "card")` or `"embed"` link shows as
// a card or the site's player (see lib/linkPreviews).
md.core.ruler.push('link_previews', (state) => {
  const tokens = state.tokens
  for (let i = 1; i < tokens.length - 1; i++) {
    const inline = tokens[i]
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open') continue
    const children = inline.children ?? []
    const [open, close] = [children[0], children[children.length - 1]]
    if (open?.type !== 'link_open' || close?.type !== 'link_close') continue
    const label = children.slice(1, -1)
    if (label.some((child) => child.type !== 'text')) continue
    const view = open.attrGet('title')
    const href = String(open.attrGet('href') ?? '')
    if ((view !== 'card' && view !== 'embed') || !/^https?:\/\//i.test(href)) continue
    const preview = new state.Token('link_preview', '', 0)
    preview.meta = { href, view, label: label.map((child) => child.content).join('') }
    inline.children = [preview]
    tokens[i - 1].hidden = tokens[i + 1].hidden = true
  }
})

md.renderer.rules.link_preview = (tokens, idx, _options, env) => {
  const { href, view, label } = tokens[idx].meta as { href: string; view: string; label: string }
  const { links, embeds } = (env as RenderEnv | undefined) ?? {}
  const preview = links?.[href]
  // Lists of notes show cards: a page of players would load every site.
  return view === 'embed' && embeds
    ? linkEmbedHtml(href, label, preview)
    : linkCardHtml(href, label, preview)
}

type RenderEnv = {
  docId?: string
  tasks?: boolean
  /** The note's stored images, by `src`. */
  images?: Record<string, StoredImage> | null
  /** The previews of its card and embed links, by URL. */
  links?: Record<string, LinkPreview> | null
  /** Embed links play in place; otherwise they show as cards. */
  embeds?: boolean
  /** Note ids by title, to resolve `[[Title]]`; without it links show unresolved. */
  notes?: NoteTitleIndex | null
}

// Players only from known sites, whatever the HTML says.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'iframe' && !isEmbedSrc((node as Element).getAttribute('src') ?? '')) {
    node.parentNode?.removeChild(node)
  }
})

/**
 * A note's Markdown as HTML. markdown-it escapes everything it doesn't
 * produce itself and refuses `javascript:` links; DOMPurify runs on top in
 * case a plugin ever lets something through.
 */
export function renderNote(
  body: string,
  { docId, tasks = false, images, links, embeds = false, notes }: RenderEnv = {},
) {
  // docId keeps footnote anchors apart when several notes share a page.
  const html = md.render(body, { docId, tasks, images, links, embeds, notes })
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target'],
    ...(embeds
      ? {
          ADD_TAGS: ['iframe'],
          ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'loading', 'referrerpolicy'],
        }
      : {}),
  })
}

// A task line: optional quote markers, the list marker, then `[ ]`/`[x]`.
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])\]/

/** `body` with the task on `line` (0-based) checked or unchecked. */
export function toggleTaskAt(body: string, line: number) {
  const lines = body.split('\n')
  const match = TASK_LINE.exec(lines[line] ?? '')
  if (!match) return body
  const checked = match[2] !== ' '
  lines[line] = match[1] + (checked ? ' ' : 'x') + lines[line].slice(match[0].length - 1)
  return lines.join('\n')
}
