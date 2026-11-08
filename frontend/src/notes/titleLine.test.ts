import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { firstLineTitle } from './titleLine'

function titleLines(state: EditorState) {
  const lines: number[] = []
  state.field(firstLineTitle).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number)
  })
  return lines
}

function stateOf(doc: string) {
  return EditorState.create({ doc, extensions: [firstLineTitle] })
}

describe('firstLineTitle', () => {
  it('marks the first line', () => {
    expect(titleLines(stateOf('test\nmore'))).toEqual([1])
    expect(titleLines(stateOf('# Trip\nmore'))).toEqual([1])
  })

  it('skips blank lines before it', () => {
    expect(titleLines(stateOf('\n\ntest\nmore'))).toEqual([3])
  })

  it('marks the empty line of an empty note, where the title will be', () => {
    expect(titleLines(stateOf(''))).toEqual([1])
  })

  it('leaves lists, quotes and code with their own look', () => {
    expect(titleLines(stateOf('- [ ] Milk'))).toEqual([])
    expect(titleLines(stateOf('1. First'))).toEqual([])
    expect(titleLines(stateOf('> Quoted'))).toEqual([])
    expect(titleLines(stateOf('```sh\nls\n```'))).toEqual([])
  })

  it('follows the text as it changes', () => {
    const state = stateOf('test\nmore').update({ changes: { from: 0, insert: 'new\n' } }).state
    expect(titleLines(state)).toEqual([1])
    const cleared = state.update({ changes: { from: 0, to: 4 } }).state
    expect(cleared.doc.line(1).text).toBe('test')
    expect(titleLines(cleared)).toEqual([1])
  })
})
