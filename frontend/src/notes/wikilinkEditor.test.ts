import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { livePreview } from './livePreview'
import { setNoteTitles, suggestNotes, wikilinks } from './wikilinkEditor'
import type { NoteTitle } from './wikilinks'

const TITLES: NoteTitle[] = [
  { id: 'saved', title: 'Plan' },
  { id: 'shown', title: 'plan' },
  { id: 'trip', title: 'Trip' },
  { id: 'odd', title: 'A | B' },
]

let view: EditorView

function open(doc: string, { titles = TITLES as NoteTitle[] | null, onOpen = vi.fn() } = {}) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), livePreview(), wikilinks(onOpen, titles)],
  })
  ensureSyntaxTree(state, state.doc.length)
  view = new EditorView({ state, parent: document.body })
  view.dispatch({})
  return view
}

const text = () => view.contentDOM.textContent ?? ''

afterEach(() => view?.destroy())

describe('wikilinks in the editor', () => {
  it('read as their text away from the cursor', () => {
    open('x\n[[Plan|the plan]], [[Trip#Day 1]] and [[Nowhere]]')
    expect(text()).toBe('xthe plan, Trip › Day 1 and Nowhere')
    expect(view.contentDOM.querySelector('.cm-wikilink-unresolved')?.textContent).toBe('Nowhere')
  })

  it('show as written under the cursor', () => {
    open('[[Plan|it]]')
    view.dispatch({ selection: { anchor: 3 } })
    view.focus()
    view.contentDOM.dispatchEvent(new FocusEvent('focus'))
    expect(text()).toBe('[[Plan|it]]')
  })

  it('stay text in code', () => {
    open('`[[Plan]]`')
    expect(view.contentDOM.querySelector('.cm-wikilink')).toBeNull()
  })

  it('resolve once the titles arrive', () => {
    open('[[Trip]]', { titles: null })
    expect(view.contentDOM.querySelector('.cm-wikilink-unresolved')).toBeNull()
    view.dispatch({ effects: setNoteTitles.of([{ id: 'x', title: 'Other' }]) })
    expect(view.contentDOM.querySelector('.cm-wikilink-unresolved')?.textContent).toBe('Trip')
  })
})

describe('suggestNotes', () => {
  function suggest(doc: string, pos = doc.length) {
    open(doc)
    return suggestNotes(new CompletionContext(view.state, pos, false))
  }

  it('offers each title once after [[, skipping ones a link cannot hold', () => {
    const result = suggest('See [[pl')
    expect(result?.from).toBe(6)
    expect(result?.options.map((option) => option.label)).toEqual(['Plan', 'Trip'])
  })

  it('waits for [[, and not after an embed', () => {
    expect(suggest('See [pl')).toBeNull()
    expect(suggest('See ![[pl')).toBeNull()
  })

  it('completes and closes the link, over a ]] already there', () => {
    for (const doc of ['[[pl', '[[pl]]']) {
      const result = suggest(doc, 4)!
      const option = result.options[0]
      ;(option.apply as (...args: unknown[]) => void)(view, option, result.from, 4)
      expect(view.state.doc.toString()).toBe('[[Plan]]')
      expect(view.state.selection.main.head).toBe(8)
      view.destroy()
    }
  })
})
