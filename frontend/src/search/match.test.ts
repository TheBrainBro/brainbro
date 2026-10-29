import { describe, expect, it } from 'vitest'

import { highlight, searchWords, snippet } from './match'

describe('search matching', () => {
  it('splits a query into words without case or accents', () => {
    expect(searchWords('  Café   ÑANDÚ ')).toEqual(['cafe', 'nandu'])
  })

  it('marks every match, ignoring case and accents, in the original text', () => {
    expect(highlight('Un café en Cafetería', ['cafe'])).toEqual([
      { text: 'Un ', match: false },
      { text: 'café', match: true },
      { text: ' en ', match: false },
      { text: 'Cafe', match: true },
      { text: 'tería', match: false },
    ])
  })

  it('merges overlapping matches', () => {
    expect(highlight('kubernetes', ['kube', 'bern'])).toEqual([
      { text: 'kubern', match: true },
      { text: 'etes', match: false },
    ])
  })

  it('cuts a one-line snippet around the first match, starting on a word', () => {
    const text = `${'lorem ipsum '.repeat(10)}\n\nthe deploy guide${' dolor sit'.repeat(20)}`
    const cut = snippet(text, ['deploy'], 60)!
    expect(cut).toMatch(/^…\w+ .*the deploy guide.*…$/)
    expect(cut).not.toContain('\n')
    expect(cut.length).toBeLessThanOrEqual(62)
  })

  it('has no snippet when nothing matches as written', () => {
    expect(snippet('python notes', ['pythn'])).toBeNull()
    expect(snippet('short note', ['note'])).toBe('short note')
  })
})
