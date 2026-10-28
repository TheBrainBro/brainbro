import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import { livePreview } from './livePreview'

const NOTE = [
  '# Title',
  '',
  'Some **bold**, *em*, ~~gone~~, `code` and [a link](https://example.com "t").',
  '',
  '> quoted',
  '',
  '- [ ] todo',
  '- [x] done',
  '- plain',
  '',
  '---',
  '',
  '![a cat](https://tracker.example/cat.png)',
  '',
  '| A | B |',
  '|--:|---|',
  '| 1 | <b>2</b> |',
  '',
].join('\n')

let view: EditorView

function open(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), livePreview()],
  })
  ensureSyntaxTree(state, state.doc.length)
  view = new EditorView({ state, parent: document.body })
  // Nudge a rebuild now that the tree is complete.
  view.dispatch({})
  return view
}

const text = () => view.contentDOM.textContent ?? ''

afterEach(() => view?.destroy())

describe('live preview', () => {
  it('renders the Markdown without changing the text', () => {
    open(NOTE)
    const shown = text()
    for (const marker of ['# ', '**', '~~', '`', '](', '> ', '- [', '---', '![']) {
      expect(shown).not.toContain(marker)
    }
    expect(shown).toContain('Title')
    expect(shown).toContain('a link')
    expect(shown).not.toContain('https://example.com')
    expect(view.contentDOM.querySelector('.cm-md-image')).toHaveTextContent('a cat')
    // CodeMirror's own cursor buffers are src-less imgs; nothing remote loads.
    expect(view.contentDOM.querySelector('img[src]')).toBeNull()
    expect(view.state.doc.toString()).toBe(NOTE)
  })

  it('renders tables as plain-text cells, never markup', () => {
    open(NOTE)
    const table = view.dom.querySelector('.cm-md-table table')!
    expect(table.querySelectorAll('th')).toHaveLength(2)
    const cells = [...table.querySelectorAll('td')]
    expect(cells.map((cell) => cell.textContent)).toEqual(['1', '<b>2</b>'])
    expect(cells[0].style.textAlign).toBe('right')
    expect(table.querySelector('b')).toBeNull()
  })

  it('toggles a task in the text when its box is clicked', () => {
    open(NOTE)
    const [todo, done] = view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-task')
    expect([todo.checked, done.checked]).toEqual([false, true])

    todo.click()
    expect(view.state.doc.toString()).toBe(NOTE.replace('- [ ] todo', '- [x] todo'))
    view.contentDOM.querySelectorAll<HTMLInputElement>('input.cm-md-task')[1].click()
    expect(view.state.doc.toString()).toBe(
      NOTE.replace('- [ ] todo', '- [x] todo').replace('- [x] done', '- [ ] done'),
    )
  })

  it('shows the Markdown of the line and the element under the cursor', () => {
    open(NOTE)
    view.focus()
    view.dispatch({ selection: { anchor: 3 } })
    expect(text()).toContain('# Title')
    expect(text()).not.toContain('**bold**')

    const bold = NOTE.indexOf('bold')
    view.dispatch({ selection: { anchor: bold } })
    expect(text()).toContain('**bold**')
    expect(text()).not.toContain('*em*')
    expect(text()).not.toContain('# Title')
  })
})
