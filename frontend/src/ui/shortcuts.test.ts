import { describe, expect, it } from 'vitest'

import { shortcutsFor } from './shortcuts'

function titles(pathname: string) {
  return shortcutsFor(pathname).map((group) => group.title)
}

describe('shortcutsFor', () => {
  it('lists the shortcuts of each screen, and ? everywhere', () => {
    expect(titles('/')).toEqual(['Inbox', 'Lists', 'Viewer', 'Everywhere'])
    expect(titles('/collections')).toEqual(['Sorting', 'Everywhere'])
    expect(titles('/collections/c1')).toEqual(['Lists', 'Sorting', 'Viewer', 'Everywhere'])
    expect(titles('/notes/n1')).toEqual(['Note', 'Everywhere'])
    expect(titles('/boards/b1')).toEqual(['Tools', 'Board', 'Viewer', 'Everywhere'])
    expect(titles('/boards')).toEqual(['Sorting', 'Everywhere'])
  })

  it('names the modifier key for this system', () => {
    const board = shortcutsFor('/boards/b1').find((group) => group.title === 'Board')!
    // jsdom is not a Mac.
    expect(board.shortcuts.find((s) => s.label === 'Undo')?.keys).toEqual(['Ctrl+Z'])
  })
})
