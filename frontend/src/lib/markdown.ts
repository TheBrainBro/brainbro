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

// Remote images are not loaded: they'd tell any site when a note is open.
// The alt text stands in for them.
md.renderer.rules.image = (tokens, idx) => {
  const alt = tokens[idx].children?.map((child) => child.content).join('') || 'image'
  return `<span class="markdown-image">${md.utils.escapeHtml(alt)}</span>`
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

type RenderEnv = { docId?: string; tasks?: boolean }

/**
 * A note's Markdown as HTML. markdown-it escapes everything it doesn't
 * produce itself and refuses `javascript:` links; DOMPurify runs on top in
 * case a plugin ever lets something through.
 */
export function renderNote(body: string, { docId, tasks = false }: RenderEnv = {}) {
  // docId keeps footnote anchors apart when several notes share a page.
  const html = md.render(body, { docId, tasks })
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
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
