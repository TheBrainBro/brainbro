import { describe, expect, it } from 'vitest'

import type { Collection } from './api'
import {
  ancestorsOf,
  childrenOf,
  collectionPath,
  collectionSummary,
  moveCollection,
  withDescendants,
} from './collectionTree'

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

  it('moves a collection next to another, or first inside a collection', () => {
    const ids = (parent: string | null, list: Collection[]) =>
      childrenOf(list, parent).map((c) => c.id)
    const after = moveCollection(all, 'Home', 'Clients', 'Acme')
    expect(ids('Clients', after)).toEqual(['Acme', 'Home', 'Globex'])
    expect(ids(null, after)).toEqual(['Work'])
    const first = moveCollection(all, 'Globex', 'Clients', null)
    expect(ids('Clients', first)).toEqual(['Globex', 'Acme'])
    const top = moveCollection(all, 'Acme', null, null)
    expect(ids(null, top)).toEqual(['Acme', 'Work', 'Home'])
    const empty = moveCollection(all, 'Work', 'Home', null)
    expect(ids('Home', empty)).toEqual(['Work'])
  })

  it('says what a collection is and holds', () => {
    expect(collectionSummary(all, all[1])).toBe('Project · 0 items · 2 collections')
    expect(collectionSummary(all, { ...all[4], item_count: 1 })).toBe('Project · 1 item')
  })
})
