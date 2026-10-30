import { describe, expect, it } from 'vitest'

import { noteTitle } from './title'

describe('noteTitle', () => {
  it('is the first line with its Markdown taken out', () => {
    expect(noteTitle('\n\n## *Trip* plan\nmore')).toBe('Trip plan')
    expect(noteTitle('> - [x] Read [the docs](https://example.com) `now`')).toBe('Read the docs now')
    expect(noteTitle('1. ==First== step')).toBe('First step')
  })

  it('falls back to Note when there are no words', () => {
    expect(noteTitle('')).toBe('Note')
    expect(noteTitle('#  ')).toBe('Note')
  })

  it('stays short', () => {
    expect(noteTitle('a'.repeat(200))).toHaveLength(80)
  })
})
