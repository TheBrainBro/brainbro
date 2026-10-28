import { describe, expect, it } from 'vitest'

import { remainingShare, shareToCaptureInputs, type SharedContent } from './inputs'
import type { Share } from './queue'

const shared = (overrides: Partial<SharedContent>): SharedContent => ({
  title: '',
  text: '',
  url: '',
  files: [],
  ...overrides,
})

describe('shareToCaptureInputs', () => {
  it('turns a shared page into a link, dropping the title its preview brings', () => {
    expect(
      shareToCaptureInputs(shared({ title: 'Example', url: 'https://example.com/a' })).inputs,
    ).toEqual([{ kind: 'url', url: 'https://example.com/a' }])
  })

  it('reads a URL that apps send as the text', () => {
    expect(shareToCaptureInputs(shared({ text: ' https://youtu.be/x ' })).inputs).toEqual([
      { kind: 'url', url: 'https://youtu.be/x' },
    ])
  })

  it('keeps text and URL together as one note, without repeating the URL', () => {
    expect(
      shareToCaptureInputs(shared({ text: 'Look at this', url: 'https://example.com' })).inputs,
    ).toEqual([{ kind: 'text', text: 'Look at this\nhttps://example.com' }])
    expect(
      shareToCaptureInputs(
        shared({ text: 'Look https://example.com', url: 'https://example.com' }),
      ).inputs,
    ).toEqual([{ kind: 'text', text: 'Look https://example.com' }])
  })

  it('keeps the title of a shared note', () => {
    expect(shareToCaptureInputs(shared({ title: 'Groceries', text: 'milk' })).inputs).toEqual([
      { kind: 'text', text: 'Groceries\n\nmilk' },
    ])
  })

  it('makes one input per file, then the text', () => {
    const photo = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    const doc = new File(['y'], 'doc.pdf', { type: 'application/pdf' })
    expect(shareToCaptureInputs(shared({ text: 'Caption', files: [photo, doc] })).inputs).toEqual([
      { kind: 'file', file: photo },
      { kind: 'file', file: doc },
      { kind: 'text', text: 'Caption' },
    ])
  })

  it('finds nothing in an empty share', () => {
    expect(shareToCaptureInputs(shared({ title: ' ', text: '\n' })).inputs).toEqual([])
  })
})

describe('remainingShare', () => {
  const photo = new File(['x'], 'photo.jpg')
  const share: Share = {
    id: 's1',
    createdAt: 1,
    title: 'T',
    text: 'hello',
    url: 'https://example.com',
    files: [photo, new File(['y'], 'other.jpg')],
  }

  it('keeps only the inputs still waiting', () => {
    expect(remainingShare(share, [{ kind: 'file', file: photo }])).toEqual({
      ...share,
      title: '',
      text: '',
      url: '',
      files: [photo],
    })
    expect(remainingShare(share, [{ kind: 'text', text: 'T\n\nhello' }])).toEqual({
      ...share,
      files: [],
    })
  })
})
