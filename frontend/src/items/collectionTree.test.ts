import { describe, expect, it } from 'vitest'

import type { Collection } from './api'
import { ancestorsOf, childrenOf, collectionPath, withDescendants } from './collectionTree'

function collection(id: string, parent: string | null = null): Collection {
  return {
    id,
    name: id,
    kind: 'project',
    color: '',
    icon: '',
    image_url: null,
    parent,
    item_count: 0,
    created_at: '',
    updated_at: '',
  }
}

const all = [
  collection('Work'),
  collection('Clients', 'Work'),
  collection('Acme', 'Clients'),
  collection('Globex', 'Clients'),
  collection('Home'),
]

describe('collection tree', () => {
  it('finds what is directly inside a collection, or at the top', () => {
    expect(childrenOf(all, null).map((c) => c.id)).toEqual(['Work', 'Home'])
    expect(childrenOf(all, 'Clients').map((c) => c.id)).toEqual(['Acme', 'Globex'])
    expect(childrenOf(all, 'Acme')).toEqual([])
  })

  it('walks up from a collection to the top', () => {
    expect(ancestorsOf(all, 'Acme').map((c) => c.id)).toEqual(['Work', 'Clients'])
    expect(ancestorsOf(all, 'Work')).toEqual([])
    expect(collectionPath(all, 'Acme')).toBe('Work / Clients')
    expect(collectionPath(all, 'Home')).toBe('')
  })

  it('collects a collection and everything inside it', () => {
    expect(withDescendants(all, 'Work')).toEqual(new Set(['Work', 'Clients', 'Acme', 'Globex']))
    expect(withDescendants(all, 'Home')).toEqual(new Set(['Home']))
  })

  it('stops on a loop instead of hanging', () => {
    const loop = [collection('A', 'B'), collection('B', 'A')]
    expect(ancestorsOf(loop, 'A').map((c) => c.id)).toEqual(['B'])
  })
})
