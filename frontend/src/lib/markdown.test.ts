import { describe, expect, it } from 'vitest'

import { imageKey, renderNote } from './markdown'

describe('renderNote images', () => {
  const body = [
    '![cat](https://tracker.example/cat.png)',
    '![spaced](<https://x.example/a b.png>)',
    '![new](https://x.example/new.png)',
    '![gone](https://x.example/gone.png)',
    '![unknown](https://x.example/unknown.png)',
  ].join(' ')

  it('shows stored copies and never loads the remote image', () => {
    const html = renderNote(body, {
      images: {
        'https://tracker.example/cat.png': { status: 'ready', url: '/api/note-images/1/file/?v=a' },
        'https://x.example/a%20b.png': { status: 'ready', url: '/api/note-images/2/file/?v=b' },
        'https://x.example/new.png': { status: 'pending', url: null },
        'https://x.example/gone.png': { status: 'failed', url: null },
      },
    })
    const root = document.createElement('div')
    root.innerHTML = html
    const images = [...root.querySelectorAll('img')]
    expect(images.map((img) => [img.getAttribute('src'), img.alt])).toEqual([
      ['/api/note-images/1/file/?v=a', 'cat'],
      ['/api/note-images/2/file/?v=b', 'spaced'],
    ])
    expect(images.every((img) => img.getAttribute('loading') === 'lazy')).toBe(true)
    const chips = [...root.querySelectorAll('.markdown-image')]
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute('data-status')])).toEqual([
      ['new', 'pending'],
      ['gone', 'failed'],
      ['unknown', null],
    ])
    expect(html).not.toContain('x.example')
    expect(html).not.toContain('tracker.example')
  })

  it('without stored images, the alt text stands in', () => {
    expect(renderNote('![cat](https://tracker.example/cat.png)')).toBe(
      '<p><span class="markdown-image">cat</span></p>\n',
    )
  })
})

describe('imageKey', () => {
  it('reads a destination as markdown-it does', () => {
    expect(imageKey('https://x.example/a.png')).toBe('https://x.example/a.png')
    expect(imageKey('<https://x.example/a b.png>')).toBe('https://x.example/a%20b.png')
    expect(imageKey('https://x.example/a\\_b.png')).toBe('https://x.example/a_b.png')
    expect(imageKey('attachments/0f.png')).toBe('attachments/0f.png')
  })
})
