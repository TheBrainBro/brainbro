import { syntaxTree } from '@codemirror/language'
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

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

function build(state: EditorState, focused: boolean): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const ranges = focused ? state.selection.ranges : []
  const touches = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const lineActive = (pos: number) => {
    const line = state.doc.lineAt(pos)
    return touches(line.from, line.to)
  }
  const lineClass = (from: number, to: number, className: string) => {
    const mark = Decoration.line({ class: className })
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      decorations.push(mark.range(line.from))
      pos = line.to + 1
    }
  }
  // The marker plus the space after it (`# `, `> `, `- `).
  const withSpace = (to: number) => (state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to)

  syntaxTree(state).iterate({
    enter: (ref) => {
      const { name, from, to } = ref
      const node = ref.node
      const parent = node.parent?.name
      switch (name) {
        case 'HeaderMark':
          if (parent?.startsWith('ATXHeading') && !lineActive(from)) {
            decorations.push(hide.range(from, withSpace(to)))
          }
          break
        case 'QuoteMark':
          if (!lineActive(from)) decorations.push(hide.range(from, withSpace(to)))
          break
        case 'Blockquote':
          lineClass(from, to, 'cm-md-quote-line')
          break
        case 'FencedCode':
        case 'CodeBlock':
          lineClass(from, to, 'cm-md-codeblock')
          return false
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
        case 'EmphasisMark':
        case 'StrikethroughMark':
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
          if (touches(from, to)) break
          // `[text](url "title")` and `[text][ref]` read as `text`.
          const [open, close] = node.getChildren('LinkMark')
          if (open && close) {
            decorations.push(hide.range(open.from, open.to), hide.range(close.from, to))
          }
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
      '.cm-line.cm-md-quote-line': {
        borderLeft: '2px solid var(--md-rule)',
        paddingLeft: '0.75rem',
        color: 'var(--md-muted)',
      },
      '.cm-line.cm-md-codeblock': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.875em',
        background: 'var(--md-subtle)',
        padding: '0 0.75rem',
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
