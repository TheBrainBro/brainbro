import { describe, expect, it } from 'vitest'

import type { Item, ItemStatus } from './api'
import { triageMessage, undoTriage } from './triage'

function item(id: string, status: ItemStatus, collections: string[] = []) {
  return { id, status, collections } as Item
}

describe('undoTriage', () => {
  it('puts archived items back where each one was', () => {
    const before = [
      item('a', 'inbox'),
      item('b', 'organized', ['work']),
      item('c', 'inbox'),
      item('d', 'organized', ['work']),
      item('e', 'organized', ['home']),
    ]
    expect(undoTriage('archive', before)).toEqual([
      { ids: ['a', 'c'], action: 'inbox' },
      { ids: ['b', 'd'], action: 'organize', collections: ['work'] },
      { ids: ['e'], action: 'organize', collections: ['home'] },
    ])
  })

  it('sends items moved to the inbox back to the archive', () => {
    expect(undoTriage('inbox', [item('a', 'archived')])).toEqual([{ ids: ['a'], action: 'archive' }])
  })

  it('offers nothing for organizing, deleting, or an organized item with no collection', () => {
    expect(undoTriage('organize', [item('a', 'inbox')])).toBeNull()
    expect(undoTriage('delete', [item('a', 'inbox')])).toBeNull()
    expect(undoTriage('archive', [item('a', 'organized')])).toBeNull()
  })
})

describe('triageMessage', () => {
  it('counts what was done', () => {
    expect(triageMessage('archive', 1)).toBe('Archived 1 item')
    expect(triageMessage('inbox', 3)).toBe('Moved 3 items to the inbox')
    expect(triageMessage('organize', 2, 'Work, Home')).toBe('Organized 2 items into Work, Home')
  })
})
