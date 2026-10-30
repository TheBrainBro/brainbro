import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'

import type { NoteImages, NoteLinks } from '../items/api'
import { setNoteLinks } from './linkWidgets'
import { livePreview, setNoteImages } from './livePreview'

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

function open(doc: string, images?: NoteImages) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), livePreview(images)],
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

  it('shows the stored copy of an image, looked up by its src, never the remote one', () => {
    const doc = [
      '![cat](https://tracker.example/cat.png) ![spaced](<https://x.example/a b.png>)',
      '',
      '![dog][pet] ![gone](https://x.example/gone.png) ![new](https://x.example/new.png)',
      '',
      '[pet]: https://x.example/dog.png',
      '',
    ].join('\n')
    open(doc, {
      'https://tracker.example/cat.png': { status: 'ready', url: '/api/note-images/1/file/?v=a' },
      'https://x.example/a%20b.png': { status: 'ready', url: '/api/note-images/2/file/?v=b' },
      'https://x.example/dog.png': { status: 'ready', url: '/api/note-images/3/file/?v=c' },
      'https://x.example/gone.png': { status: 'failed', url: null },
      'https://x.example/new.png': { status: 'pending', url: null },
    })
    const sources = [...view.contentDOM.querySelectorAll('img.cm-md-img')].map((img) =>
      img.getAttribute('src'),
    )
    expect(sources).toEqual([
      '/api/note-images/1/file/?v=a',
      '/api/note-images/2/file/?v=b',
      '/api/note-images/3/file/?v=c',
    ])
    expect(view.contentDOM.querySelector('img[alt="cat"]')).not.toBeNull()
    const failed = view.contentDOM.querySelector('.cm-md-image[data-status="failed"]')!
    expect(failed).toHaveTextContent('gone')
    expect(failed).toHaveAttribute('title', "Couldn't load this image")
    expect(view.contentDOM.querySelector('.cm-md-image[data-status="pending"]')).toHaveTextContent(
      'new',
    )
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('swaps the placeholder for the copy once it is ready', () => {
    open('![cat](https://x.example/cat.png)\n', {
      'https://x.example/cat.png': { status: 'pending', url: null },
    })
    expect(view.contentDOM.querySelector('img.cm-md-img')).toBeNull()
    view.dispatch({
      effects: setNoteImages.of({
        'https://x.example/cat.png': { status: 'ready', url: '/api/note-images/1/file/' },
      }),
    })
    expect(view.contentDOM.querySelector('img.cm-md-img')).toHaveAttribute(
      'src',
      '/api/note-images/1/file/',
    )
  })
})

describe('livePreview link cards', () => {
  const preview = {
    status: 'ready',
    title: 'A post',
    description: 'What it says',
    site_name: 'Blog',
    image_url: '/api/note-links/1/image/?v=a.webp',
  }

  function switchTo(label: string) {
    const button = [...view.dom.querySelectorAll<HTMLButtonElement>('.cm-link-switch button')].find(
      (candidate) => candidate.textContent === label,
    )!
    button.click()
  }

  it('shows a card line as the card, with its stored preview once it is in', () => {
    open('Intro\n\n[read](https://blog.example/a "card")\n')
    expect(view.dom.querySelector('.link-card')?.getAttribute('data-status')).toBe('pending')
    view.dispatch({ effects: setNoteLinks.of({ 'https://blog.example/a': preview } as NoteLinks) })
    const card = view.dom.querySelector('.link-card')!
    expect(card.textContent).toContain('A post')
    expect(card.querySelector('img')?.getAttribute('src')).toBe(preview.image_url)
  })

  it('turns a bare link into a card and back, rewriting only its line', () => {
    open('Intro\n\nhttps://blog.example/a\n')
    switchTo('Card')
    expect(view.state.doc.toString()).toBe(
      'Intro\n\n[https://blog.example/a](https://blog.example/a "card")\n',
    )
    switchTo('Link')
    expect(view.state.doc.toString()).toBe('Intro\n\nhttps://blog.example/a\n')
  })

  it('offers Embed only for sites with a player, and plays it in place', () => {
    open('[talk](https://vimeo.com/12345)\n')
    switchTo('Embed')
    expect(view.state.doc.toString()).toBe('[talk](https://vimeo.com/12345 "embed")\n')
    expect(view.dom.querySelector('iframe')?.getAttribute('src')).toBe(
      'https://player.vimeo.com/video/12345',
    )

    view.destroy()
    open('https://blog.example/a\n')
    const labels = [...view.dom.querySelectorAll('.cm-link-switch button')].map((b) => b.textContent)
    expect(labels).toEqual(['Link', 'Card'])
  })

  it('leaves links inside code alone', () => {
    open('```\nhttps://blog.example/a\n```\n')
    expect(view.dom.querySelector('.cm-link-switch')).toBeNull()
  })
})
