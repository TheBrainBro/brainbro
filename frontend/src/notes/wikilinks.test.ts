import { describe, expect, it } from 'vitest'

import { renderNote } from '../lib/markdown'
import {
  findWikilinks,
  noteTitleIndex,
  resolveWikilink,
  wikilinkLabel,
  wikilinkTarget,
} from './wikilinks'

const index = noteTitleIndex([
  { id: 'saved', title: 'Plan' },
  { id: 'shown', title: 'plan' },
  { id: 'trip', title: 'Trip' },
])

describe('wikilinks', () => {
  it('finds links, not embeds', () => {
    const links = findWikilinks('See [[Plan#top|it]], ![[pic.png]] and [[Trip]]')
    expect(links.map(({ target, heading, text }) => [target, heading, text])).toEqual([
      ['Plan', 'top', 'it'],
      ['Trip', null, null],
    ])
    expect(links[1]).toMatchObject({ from: 38, to: 46, targetEnd: 44 })
  })

  it('resolves like the graph: first title wins, case-insensitive, vault paths too', () => {
    expect(resolveWikilink(index, 'PLAN')).toBe('saved')
    expect(resolveWikilink(index, ' Folder/Trip.md ')).toBe('trip')
    expect(resolveWikilink(index, 'Nowhere')).toBeNull()
    expect(wikilinkTarget('a/b/Plan.md')).toBe('Plan')
  })

  it('reads as its text, or the title and heading', () => {
    expect(wikilinkLabel({ target: 'Plan', heading: 'top', text: 'it' })).toBe('it')
    expect(wikilinkLabel({ target: 'Plan', heading: 'top', text: null })).toBe('Plan › top')
    expect(wikilinkLabel({ target: 'Plan', heading: null, text: ' ' })).toBe('Plan')
  })
})

describe('renderNote wikilinks', () => {
  function render(body: string, notes = index) {
    const root = document.createElement('div')
    root.innerHTML = renderNote(body, { notes })
    return root
  }

  it('links to the note, showing its text', () => {
    const link = render('Go to [[plan|the plan]].').querySelector('a.wikilink')!
    expect(link.getAttribute('href')).toBe('/notes/saved')
    expect(link.getAttribute('data-note')).toBe('saved')
    expect(link.getAttribute('target')).toBeNull()
    expect(link.textContent).toBe('the plan')
  })

  it('marks links to no note, and leaves embeds and code alone', () => {
    const root = render('[[Nowhere]] ![[pic.png]] `[[Plan]]`')
    expect(root.querySelector('.wikilink-unresolved')?.textContent).toBe('Nowhere')
    expect(root.querySelectorAll('.wikilink')).toHaveLength(1)
    expect(root.textContent).toContain('![[pic.png]]')
    expect(root.querySelector('code')?.textContent).toBe('[[Plan]]')
  })

  it('escapes the text', () => {
    const root = render('[[Plan|<img src=x onerror=alert(1)>]]')
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('a.wikilink')?.textContent).toBe('<img src=x onerror=alert(1)>')
  })

  it('shows plain without titles to resolve against', () => {
    const root = document.createElement('div')
    root.innerHTML = renderNote('[[Plan]]')
    expect(root.querySelector('span.wikilink:not(.wikilink-unresolved)')?.textContent).toBe('Plan')
  })
})
