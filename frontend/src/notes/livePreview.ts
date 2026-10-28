import { syntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

import { emojiByName } from '../lib/markdown'
import { dialectDecorations, GlyphWidget } from './dialect'

/*
 * Live preview: the note reads as rendered Markdown, and the Markdown shows
 * only where the cursor is (its line for block markers, the element for
 * inline ones). Everything here is decorations over the text, which is never
 * changed by them: what is stored stays exactly what was typed.
 */

const hide = Decoration.replace({})

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const bullet = document.createElement('span')
    bullet.className = 'cm-md-bullet'
    bullet.textContent = '•'
    return bullet
  }
}

/** Toggles `[ ]` ↔ `[x]` in the text when clicked. */
class TaskWidget extends WidgetType {
  readonly checked: boolean
  constructor(checked: boolean) {
    super()
    this.checked = checked
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Done' : 'To do')
    // Keep the cursor where it is: clicking a box isn't editing its line.
    box.addEventListener('mousedown', (event) => event.preventDefault())
    box.addEventListener('click', (event) => {
      event.preventDefault()
      const marker = view.posAtDOM(box)
      view.dispatch({
        changes: { from: marker + 1, to: marker + 2, insert: this.checked ? ' ' : 'x' },
        userEvent: 'input.toggle-task',
      })
    })
    return box
  }
  ignoreEvent() {
    return true
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const rule = document.createElement('span')
    rule.className = 'cm-md-hr'
    return rule
  }
}

/** Stands in for a code fence line: the language as a small label, or nothing. */
class FenceWidget extends WidgetType {
  readonly language: string
  constructor(language: string) {
    super()
    this.language = language
  }
  eq(other: FenceWidget) {
    return other.language === this.language
  }
  toDOM() {
    const label = document.createElement('span')
    label.className = 'cm-md-codelang'
    label.textContent = this.language
    return label
  }
}

/** Remote images are not loaded (they'd tell the site the note is open); the alt text stands in. */
class ImageWidget extends WidgetType {
  readonly alt: string
  constructor(alt: string) {
    super()
    this.alt = alt
  }
  eq(other: ImageWidget) {
    return other.alt === this.alt
  }
  toDOM() {
    const chip = document.createElement('span')
    chip.className = 'cm-md-image'
    chip.textContent = this.alt || 'image'
    return chip
  }
}

type Align = 'left' | 'center' | 'right' | null

class TableWidget extends WidgetType {
  readonly rows: string[][]
  readonly align: Align[]
  readonly source: string
  constructor(rows: string[][], align: Align[], source: string) {
    super()
    this.rows = rows
    this.align = align
    this.source = source
  }
  eq(other: TableWidget) {
    return other.source === this.source
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-table'
    const table = document.createElement('table')
    this.rows.forEach((cells, index) => {
      const row = table.insertRow()
      cells.forEach((text, column) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td')
        // Plain text only: cells never become markup.
        cell.textContent = text
        if (this.align[column]) cell.style.textAlign = this.align[column]
        row.append(cell)
      })
    })
    wrap.append(table)
    // Clicking the table edits it as text.
    wrap.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

function tableWidget(state: EditorState, node: SyntaxNode) {
  const rows: string[][] = []
  let align: Align[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader' || child.name === 'TableRow') {
      rows.push(
        child.getChildren('TableCell').map((cell) => state.sliceDoc(cell.from, cell.to).trim()),
      )
    } else if (
      child.name === 'TableDelimiter' &&
      state.doc.lineAt(child.from).from === child.from
    ) {
      // The |---|:--:| line.
      align = state
        .sliceDoc(child.from, child.to)
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((spec) => {
          const cell = spec.trim()
          if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
          if (cell.endsWith(':')) return 'right'
          if (cell.startsWith(':')) return 'left'
          return null
        })
    }
  }
  return new TableWidget(rows, align, state.sliceDoc(node.from, node.to))
}

const setFocus = StateEffect.define<boolean>()

// Nodes that already mean something: the dialect's text rules stay off them.
const EXCLUDED = new Set([
  'InlineCode',
  'URL',
  'Autolink',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'LinkReference',
  'LinkMark',
  'LinkTitle',
  'LinkLabel',
  'Image',
  'Emoji',
  'HorizontalRule',
  'TaskMarker',
  'HeaderMark',
  'QuoteMark',
  'ListMark',
  'EmphasisMark',
  'CodeMark',
  'Escape',
  'StrikethroughMark',
  'SuperscriptMark',
  'SubscriptMark',
])

type Footnote = { kind: 'ref' | 'inline' | 'definition'; label: string }

/**
 * Footnotes numbered the way markdown-it-footnote does: by first reference,
 * inline ones (`^[…]`) in turn, repeats as `n:k`. Only labels with a
 * definition are footnotes. Keyed by the Link node's start.
 */
function footnotes(state: EditorState) {
  const found: { from: number; note: Footnote }[] = []
  const defined = new Set<string>()
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'LinkReference') {
        // `[^1]: Note.` can parse as a link definition (`Note.` as its URL).
        const label = ref.node.getChild('LinkLabel')
        const text = label ? state.sliceDoc(label.from + 1, label.to - 1) : ''
        if (text.startsWith('^')) {
          defined.add(text.slice(1))
          found.push({ from: ref.from, note: { kind: 'definition', label: text.slice(1) } })
        }
        return false
      }
      if (ref.name !== 'Link') return
      const node = ref.node
      const [open, close] = node.getChildren('LinkMark')
      if (!open || !close || node.getChild('URL') || node.getChild('LinkLabel')) return false
      const label = state.sliceDoc(open.to, close.from)
      if (label.startsWith('^')) {
        const definition =
          state.doc.lineAt(ref.from).from === ref.from && state.sliceDoc(ref.to, ref.to + 1) === ':'
        if (definition) defined.add(label.slice(1))
        found.push({
          from: ref.from,
          note: { kind: definition ? 'definition' : 'ref', label: label.slice(1) },
        })
      } else if (state.sliceDoc(ref.from - 1, ref.from) === '^') {
        found.push({ from: ref.from, note: { kind: 'inline', label } })
      }
      return false
    },
  })
  const numbers = new Map<string, { n: number; uses: number }>()
  let count = 0
  const shown = new Map<number, { note: Footnote; text: string }>()
  for (const { from, note } of found) {
    if (note.kind === 'inline') shown.set(from, { note, text: `[${++count}]` })
    if (note.kind !== 'ref' || !defined.has(note.label)) continue
    const entry = numbers.get(note.label) ?? { n: ++count, uses: 0 }
    numbers.set(note.label, entry)
    shown.set(from, { note, text: `[${entry.n}${entry.uses ? `:${entry.uses}` : ''}]` })
    entry.uses++
  }
  for (const { from, note } of found) {
    if (note.kind !== 'definition') continue
    const entry = numbers.get(note.label)
    shown.set(from, { note, text: entry ? `${entry.n}.` : `${note.label}:` })
  }
  return shown
}

function build(state: EditorState, focused: boolean): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const ranges = focused ? state.selection.ranges : []
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const lineActive = (pos: number) => {
    const line = state.doc.lineAt(pos)
    return touches(line.from, line.to)
  }
  // Code block lines, with the first and last marked for rounded corners.
  const codeBlock = (from: number, to: number) => {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let number = first; number <= last; number++) {
      codeLines.add(number)
      const classes = ['cm-md-codeblock']
      if (number === first) classes.push('cm-md-codeblock-first')
      if (number === last) classes.push('cm-md-codeblock-last')
      decorations.push(
        Decoration.line({ class: classes.join(' ') }).range(state.doc.line(number).from),
      )
    }
  }
  const mark = (from: number, to: number, className: string) => {
    if (to > from) decorations.push(Decoration.mark({ class: className }).range(from, to))
  }
  // Lines inside code blocks, where blank lines are content.
  const codeLines = new Set<number>()
  // For the dialect's text rules: ranges to leave alone, lines to skip.
  const excluded: { from: number; to: number }[] = []
  const skipLines = new Set<number>()
  const notes = footnotes(state)
  // Quote depth per line (`>>` is two), so nested quotes show nested bars.
  const quoteDepth = new Map<number, number>()
  // The marker plus the space after it (`# `, `> `, `- `).
  const withSpace = (to: number) => (state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to)

  syntaxTree(state).iterate({
    enter: (ref) => {
      const { name, from, to } = ref
      const node = ref.node
      const parent = node.parent?.name
      if (EXCLUDED.has(name)) excluded.push({ from, to })
      switch (name) {
        case 'Emoji': {
          const emoji = emojiByName[state.sliceDoc(from + 1, to - 1)]
          if (emoji && !touches(from, to)) {
            decorations.push(Decoration.replace({ widget: new GlyphWidget(emoji) }).range(from, to))
          }
          break
        }
        case 'HeaderMark':
          if (parent?.startsWith('ATXHeading') && !lineActive(from)) {
            decorations.push(hide.range(from, withSpace(to)))
          }
          break
        case 'QuoteMark': {
          if (!lineActive(from)) decorations.push(hide.range(from, withSpace(to)))
          const line = state.doc.lineAt(from).number
          quoteDepth.set(line, (quoteDepth.get(line) ?? 0) + 1)
          break
        }
        case 'Blockquote':
          // Lazy continuation lines have no marker but still belong to the quote.
          for (let pos = from; pos <= to;) {
            const line = state.doc.lineAt(pos)
            if (!quoteDepth.has(line.number)) quoteDepth.set(line.number, 0)
            pos = line.to + 1
          }
          break
        case 'FencedCode': {
          const first = state.doc.lineAt(from)
          const last = state.doc.lineAt(to)
          codeBlock(first.from, last.to)
          if (touches(first.from, last.to)) return false
          // The fences give way to the language label (and nothing below).
          const info = node.getChild('CodeInfo')
          const language = info ? state.sliceDoc(info.from, info.to) : ''
          decorations.push(
            Decoration.replace({ widget: new FenceWidget(language) }).range(first.from, first.to),
            // Fence lines shrink to the label's size, or to a sliver without one.
            Decoration.line({ class: language ? 'cm-md-fence' : 'cm-md-fence-empty' }).range(
              first.from,
            ),
          )
          const closing = node.lastChild
          if (last.number > first.number && closing?.name === 'CodeMark') {
            decorations.push(
              hide.range(last.from, last.to),
              Decoration.line({ class: 'cm-md-fence-empty' }).range(last.from),
            )
          }
          return false
        }
        case 'CodeBlock': {
          const first = state.doc.lineAt(from)
          const last = state.doc.lineAt(to)
          codeBlock(first.from, last.to)
          if (touches(first.from, last.to)) return false
          // Indented code reads without the indent that makes it code.
          for (let number = first.number; number <= last.number; number++) {
            const line = state.doc.line(number)
            const indent = /^(?: {4}|\t)/.exec(line.text)
            if (indent) decorations.push(hide.range(line.from, line.from + indent[0].length))
          }
          return false
        }
        case 'ListMark': {
          if (lineActive(from)) break
          const task = node.nextSibling?.name === 'Task'
          const bullet = /^[-*+]$/.test(state.sliceDoc(from, to))
          if (task) decorations.push(hide.range(from, withSpace(to)))
          else if (bullet) {
            decorations.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to))
          }
          break
        }
        case 'TaskMarker': {
          // Raw only while the cursor is inside the brackets.
          if (ranges.some((r) => r.from > from && r.to < to)) break
          const checked = /x/i.test(state.sliceDoc(from, to))
          decorations.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(from, to))
          const text = withSpace(to)
          if (checked && node.parent!.to > text) {
            decorations.push(
              Decoration.mark({ class: 'cm-md-task-done' }).range(text, node.parent!.to),
            )
          }
          break
        }
        case 'HorizontalRule':
          if (!lineActive(from)) {
            decorations.push(
              Decoration.replace({ widget: new HorizontalRuleWidget() }).range(from, to),
            )
          }
          break
        case 'Superscript':
        case 'Subscript':
          mark(from + 1, to - 1, name === 'Superscript' ? 'cm-md-sup' : 'cm-md-sub')
          break
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'SuperscriptMark':
        case 'SubscriptMark':
          if (node.parent && !touches(node.parent.from, node.parent.to)) {
            decorations.push(hide.range(from, to))
          }
          break
        case 'CodeMark':
          if (parent === 'InlineCode' && !touches(node.parent!.from, node.parent!.to)) {
            decorations.push(hide.range(from, to))
          }
          break
        case 'Escape':
          if (!touches(from, to)) decorations.push(hide.range(from, from + 1))
          break
        case 'Link': {
          const [open, close] = node.getChildren('LinkMark')
          if (!open || !close) break
          const target = node.getChild('URL') || node.getChild('LinkLabel')
          const footnote = notes.get(from)
          if (footnote) {
            excluded.push({ from: footnote.note.kind === 'inline' ? from - 1 : from, to })
            if (footnote.note.kind === 'inline') {
              // `^[text]`: its number, then the text, muted, where it was written.
              if (touches(from - 1, to)) break
              decorations.push(
                Decoration.replace({
                  widget: new GlyphWidget(footnote.text, 'cm-md-footref'),
                }).range(from - 1, open.to),
                hide.range(close.from, close.to),
              )
              mark(open.to, close.from, 'cm-md-footinline')
              break
            }
            if (touches(from, to)) break
            const definition = footnote.note.kind === 'definition'
            // A definition's `[^1]: ` reads as `1.`; a reference as `[1]`.
            const end = definition ? withSpace(to + 1) : to
            decorations.push(
              Decoration.replace({
                widget: new GlyphWidget(
                  footnote.text,
                  definition ? 'cm-md-footdef' : 'cm-md-footref',
                ),
              }).range(from, end),
            )
            break
          }
          if (!target) {
            // `[text]` with no URL or reference is just text (`^[…]`, `*[HTML]: …`).
            mark(from, to, 'cm-md-plain')
            break
          }
          if (touches(from, to)) break
          // `[text](url "title")` and `[text][ref]` read as `text`. Children
          // are still visited: escapes and emphasis in the text render too.
          decorations.push(hide.range(open.from, open.to), hide.range(close.from, to))
          break
        }
        case 'LinkReference': {
          const footnote = notes.get(from)
          const colon = node.getChild('LinkMark')
          if (footnote && colon) {
            // A footnote definition read as a link definition: label as `1.`,
            // the rest as the plain text it is.
            mark(colon.to, to, 'cm-md-plain')
            if (!touches(from, to)) {
              decorations.push(
                Decoration.replace({
                  widget: new GlyphWidget(footnote.text, 'cm-md-footdef'),
                }).range(from, withSpace(colon.to)),
              )
            }
            return false
          }
          // `[id]: url "title"` defines a link; it isn't content.
          if (!touches(from, to)) mark(from, to, 'cm-md-refdef')
          return false
        }
        case 'Image': {
          if (touches(from, to)) break
          const marks = node.getChildren('LinkMark')
          const alt = marks.length > 1 ? state.sliceDoc(marks[0].to, marks[1].from) : ''
          decorations.push(Decoration.replace({ widget: new ImageWidget(alt) }).range(from, to))
          return false
        }
        case 'Table': {
          const first = state.doc.lineAt(from)
          const last = state.doc.lineAt(to)
          for (let number = first.number; number <= last.number; number++) skipLines.add(number)
          if (touches(first.from, last.to)) break
          decorations.push(
            Decoration.replace({ widget: tableWidget(state, node), block: true }).range(
              first.from,
              last.to,
            ),
          )
          return false
        }
      }
    },
  })
  // Blank lines after a blank line are a smaller gap: rendered Markdown
  // collapses them, and a full line each leaves holes in the note.
  for (let number = 2; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (line.text.trim() || codeLines.has(number) || touches(line.from, line.to)) continue
    if (state.doc.line(number - 1).text.trim()) continue
    decorations.push(Decoration.line({ class: 'cm-md-gap' }).range(line.from))
  }
  for (const number of codeLines) skipLines.add(number)
  decorations.push(...dialectDecorations(state, { excluded, skipLines, touches }))
  for (const [number, depth] of quoteDepth) {
    const line = state.doc.line(number)
    decorations.push(
      Decoration.line({
        class: 'cm-md-quote-line',
        attributes: { style: `--quote-depth: ${Math.max(depth, 1)}` },
      }).range(line.from),
    )
  }
  return Decoration.set(decorations, true)
}

const preview = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create: (state) => ({ focused: false, decorations: build(state, false) }),
  update(value, tr) {
    let focused = value.focused
    for (const effect of tr.effects) if (effect.is(setFocus)) focused = effect.value
    const changed =
      tr.docChanged ||
      tr.selection ||
      focused !== value.focused ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState)
    return changed ? { focused, decorations: build(tr.state, focused) } : value
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

/** Mod-click opens a link (a plain click puts the cursor in it to edit). */
function openLink(event: MouseEvent, view: EditorView) {
  if (!(event.metaKey || event.ctrlKey)) return false
  const pos = view.posAtCoords(event)
  if (pos === null) return false
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1)
  while (node && node.name !== 'Link' && node.name !== 'Autolink') node = node.parent
  const url = node?.getChild('URL')
  if (!url) return false
  const href = view.state.sliceDoc(url.from, url.to)
  if (!/^(https?:|mailto:)/i.test(href)) return false
  event.preventDefault()
  window.open(href, '_blank', 'noopener,noreferrer')
  return true
}

export function livePreview(): Extension {
  return [
    preview,
    EditorView.domEventHandlers({
      focus: (_event, view) => view.dispatch({ effects: setFocus.of(true) }),
      blur: (_event, view) => view.dispatch({ effects: setFocus.of(false) }),
      mousedown: openLink,
    }),
    EditorView.theme({
      '.cm-md-bullet': { display: 'inline-block', width: '1ch', color: 'var(--md-muted)' },
      '.cm-md-task': { margin: '0 0.4em 0 0', verticalAlign: 'middle', cursor: 'pointer' },
      '.cm-md-task-done': { color: 'var(--md-muted)', textDecoration: 'line-through' },
      '.cm-md-hr': {
        display: 'inline-block',
        width: '100%',
        verticalAlign: 'middle',
        borderTop: '1px solid var(--md-rule)',
      },
      '.cm-md-image': {
        borderRadius: '0.25rem',
        padding: '0 0.3em',
        fontSize: '0.85em',
        fontStyle: 'italic',
        color: 'var(--md-muted)',
        background: 'var(--md-subtle)',
      },
      // One bar per level: a 2px stripe every 0.75rem, as many as the depth.
      '.cm-line.cm-md-quote-line': {
        paddingLeft: 'calc(var(--quote-depth) * 0.75rem + 0.25rem)',
        backgroundImage:
          'repeating-linear-gradient(to right, var(--md-rule) 0 2px, transparent 2px 0.75rem)',
        backgroundSize: 'calc(var(--quote-depth) * 0.75rem) 100%',
        backgroundRepeat: 'no-repeat',
        color: 'var(--md-muted)',
      },
      '.cm-line.cm-md-codeblock': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.875em',
        background: 'var(--md-subtle)',
        padding: '0 0.75rem',
      },
      '.cm-line.cm-md-codeblock-first': {
        borderTopLeftRadius: '0.5rem',
        borderTopRightRadius: '0.5rem',
        paddingTop: '0.25rem',
      },
      '.cm-line.cm-md-codeblock-last': {
        borderBottomLeftRadius: '0.5rem',
        borderBottomRightRadius: '0.5rem',
        paddingBottom: '0.25rem',
      },
      '.cm-md-codelang': { color: 'var(--md-muted)' },
      '.cm-line.cm-md-fence': { fontSize: '0.75em', lineHeight: '1.6' },
      '.cm-line.cm-md-fence-empty': { fontSize: '0.75em', lineHeight: '0.75' },
      '.cm-line.cm-md-gap': { lineHeight: '0.5' },
      '.cm-md-sup': { verticalAlign: 'super', fontSize: '0.75em' },
      '.cm-md-sub': { verticalAlign: 'sub', fontSize: '0.75em' },
      '.cm-md-footref': { verticalAlign: 'super', fontSize: '0.75em' },
      '.cm-md-footdef': { fontSize: '0.85em', marginRight: '0.4em' },
      '.cm-md-footinline': { fontSize: '0.85em' },
      // Inline footnote text parses as a link: muted, nested either way.
      '.cm-md-footinline, .cm-md-footinline .cm-md-link, .cm-md-link .cm-md-footinline': {
        color: 'var(--md-muted)',
      },
      '.cm-md-ins': { textDecoration: 'underline', textUnderlineOffset: '0.2em' },
      '.cm-md-highlight': { background: 'var(--md-highlight)', borderRadius: '0.15rem' },
      '.cm-md-abbr': { textDecoration: 'underline dotted', cursor: 'help' },
      '.cm-line.cm-md-dt': { fontWeight: '600' },
      '.cm-line.cm-md-dd': { paddingLeft: '1.5rem' },
      '.cm-line.cm-md-container': {
        borderLeft: '4px solid var(--box-border)',
        background: 'var(--box-background)',
        padding: '0 0.75rem',
      },
      '.cm-line.cm-md-container-first': {
        borderTopRightRadius: '0.5rem',
        paddingTop: '0.25rem',
        fontSize: '0.75em',
      },
      '.cm-line.cm-md-container-last': {
        borderBottomRightRadius: '0.5rem',
        fontSize: '0.75em',
        lineHeight: '0.75',
      },
      '.cm-md-container-note, .cm-md-container-info': {
        '--box-border': 'var(--box-info)',
        '--box-background': 'var(--box-info-bg)',
      },
      '.cm-md-container-tip': {
        '--box-border': 'var(--box-tip)',
        '--box-background': 'var(--box-tip-bg)',
      },
      '.cm-md-container-warning': {
        '--box-border': 'var(--box-warning)',
        '--box-background': 'var(--box-warning-bg)',
      },
      '.cm-md-container-danger': {
        '--box-border': 'var(--box-danger)',
        '--box-background': 'var(--box-danger-bg)',
      },
      // Footnotes parse as links: muted instead of the link color, nested either way.
      '.cm-md-footref, .cm-md-footdef, :is(.cm-md-footref, .cm-md-footdef) .cm-md-link, .cm-md-link :is(.cm-md-footref, .cm-md-footdef)':
        { color: 'var(--md-muted)' },
      '.cm-md-refdef, .cm-md-refdef *': { fontSize: '0.85em', color: 'var(--md-muted)' },
      // Brackets that aren't links lose the link color, nested either way.
      '.cm-md-plain, .cm-md-plain .cm-md-link, .cm-md-link .cm-md-plain': {
        color: 'var(--md-text)',
      },
      '.cm-md-table': { overflowX: 'auto', cursor: 'text', padding: '0.25rem 0' },
      '.cm-md-table table': { borderCollapse: 'collapse', fontSize: '0.9em' },
      '.cm-md-table th, .cm-md-table td': {
        border: '1px solid var(--md-rule)',
        padding: '0.25rem 0.6rem',
        textAlign: 'left',
      },
      '.cm-md-table th': { fontWeight: '600' },
    }),
  ]
}
