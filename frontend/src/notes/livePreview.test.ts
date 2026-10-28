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

  it('renders escapes inside links, and brackets that are not links as text', () => {
    open('### [\\<ins>](https://x.io)\n\nA ^[inline] and *[HTML]: y\n')
    expect(text()).toContain('<ins>')
    expect(text()).not.toContain('\\<')
    const plain = view.contentDOM.querySelectorAll('.cm-md-plain')
    expect([...plain].map((node) => node.textContent)).toEqual(['[HTML]'])
  })

  it('renders footnotes and dims link definitions', () => {
    open('Text[^1].\n\n[^1]: The note.\n\n[id]: https://x.io "T"\n')
    expect(view.contentDOM.querySelector('.cm-md-footref')).toHaveTextContent('1')
    expect(view.contentDOM.querySelector('.cm-md-footdef')).toHaveTextContent('1')
    expect(text()).not.toContain('[^')
    expect(view.contentDOM.querySelector('.cm-md-refdef')).toHaveTextContent(
      '[id]: https://x.io "T"',
    )
  })

  it('nests quote bars by depth', () => {
    open('> a\n>> b\n> > > c\n')
    const depths = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-md-quote-line')].map(
      (line) => line.style.getPropertyValue('--quote-depth'),
    )
    expect(depths).toEqual(['1', '2', '3'])
  })

  it('replaces code fences with the language and drops the code indent', () => {
    open('```js\nconst a = 1\n```\n\n    indented\n')
    expect(view.contentDOM.querySelector('.cm-md-codelang')).toHaveTextContent('js')
    expect(text()).not.toContain('```')
    expect(text()).toContain('const a = 1')
    expect(text()).not.toContain('    indented')
    expect(view.contentDOM.querySelectorAll('.cm-md-codeblock-first')).toHaveLength(2)
  })

  it('renders superscript and subscript', () => {
    open('19^th^ and H~2~O\n')
    expect(text()).toBe('19th and H2O')
    expect(view.contentDOM.querySelector('.cm-md-sup')).toHaveTextContent('th')
    expect(view.contentDOM.querySelector('.cm-md-sub')).toHaveTextContent('2')
  })

  it('shrinks extra blank lines and fence lines, but not inside code', () => {
    open('a\n\n\n\nb\n\n```\nx\n\n\ny\n```\n')
    expect(view.contentDOM.querySelectorAll('.cm-md-gap')).toHaveLength(2)
    expect(view.contentDOM.querySelectorAll('.cm-md-fence-empty')).toHaveLength(2)
    expect(view.state.doc.toString()).toBe('a\n\n\n\nb\n\n```\nx\n\n\ny\n```\n')
  })

  it('numbers footnotes like markdown-it: by first reference, inline ones in turn', () => {
    open('A[^b] B^[inline] C[^b] D[^none].\n\n[^b]: Bee.\n')
    const refs = [...view.contentDOM.querySelectorAll('.cm-md-footref')].map((n) => n.textContent)
    expect(refs).toEqual(['[1]', '[2]', '[1:1]'])
    expect(view.contentDOM.querySelector('.cm-md-footinline')).toHaveTextContent('inline')
    expect(view.contentDOM.querySelector('.cm-md-footdef')).toHaveTextContent('1.')
    // No definition, no footnote.
    expect(text()).toContain('[^none]')
  })

  it('renders emoji, emoticons and typographer replacements, but not in code or URLs', () => {
    open(
      'Hi :wink: 8-) (c) (TM) +- wait... ok?.... !!!!! ,, a -- b --- c "q" it\'s\n\n`8-) (c)` https://x.io/a--b\n',
    )
    expect(text()).toContain('Hi 😉 😎 © ™ ± wait… ok?.. !!! , a – b — c “q” it’s')
    expect(text()).toContain('8-) (c)')
    expect(text()).toContain('https://x.io/a--b')
    expect(view.state.doc.toString()).toContain(':wink: 8-) (c)')
  })

  it('renders ++ins++, ==mark== and abbreviations', () => {
    open('++new++ and ==marked== in HTML, not xHTMLy.\n\n*[HTML]: Hyper Text Markup Language\n')
    expect(view.contentDOM.querySelector('.cm-md-ins')).toHaveTextContent('new')
    expect(view.contentDOM.querySelector('.cm-md-highlight')).toHaveTextContent('marked')
    expect(text()).not.toContain('++')
    expect(text()).not.toContain('==')
    const abbr = view.contentDOM.querySelectorAll('.cm-md-abbr')
    expect(abbr).toHaveLength(1)
    expect(abbr[0]).toHaveAttribute('title', 'Hyper Text Markup Language')
  })

  it('renders definition lists and containers', () => {
    open(
      'Term 1\n\n:   Definition 1\nwith lazy continuation.\n\nTerm 2\n  ~ Def 2a\n  ~ Def 2b\n\n::: warning\n*here be dragons*\n:::\n',
    )
    const lines = (selector: string) =>
      [...view.contentDOM.querySelectorAll(selector)].map((n) => n.textContent)
    expect(lines('.cm-md-dt')).toEqual(['Term 1', 'Term 2'])
    expect(lines('.cm-md-dd')).toEqual([
      'Definition 1',
      'with lazy continuation.',
      'Def 2a',
      'Def 2b',
    ])
    expect(lines('.cm-md-container-warning')).toEqual(['warning', 'here be dragons', ''])
    expect(view.state.doc.toString()).toContain('::: warning\n*here be dragons*\n:::')
  })
})
