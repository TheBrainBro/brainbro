import { describe, expect, it } from 'vitest'

import { noteTitleIndex } from '../notes/wikilinks'
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

describe('card and embed links', () => {
  const preview = {
    status: 'ready',
    title: 'A post',
    description: 'What it says',
    site_name: 'Blog',
    image_url: '/api/note-links/1/image/?v=a.webp',
  }

  it('shows a link alone in its paragraph as a card with the stored preview', () => {
    const html = renderNote('[read](https://blog.example/a "card")', {
      links: { 'https://blog.example/a': preview },
    })
    const card = new DOMParser().parseFromString(html, 'text/html').querySelector('a.link-card')!
    expect(card.getAttribute('href')).toBe('https://blog.example/a')
    expect(card.textContent).toBe('A postWhat it saysBlog')
    expect(card.querySelector('img')!.getAttribute('src')).toBe(preview.image_url)
    expect(html).not.toContain('<p>')
  })

  it('shows a pending card with the link text until the preview is in', () => {
    const html = renderNote('[read](https://blog.example/a "card")')
    expect(html).toContain('data-status="pending"')
    expect(html).toContain('>read<')
  })

  it('plays embeds only where asked, from the privacy-enhanced player', () => {
    const body = '[video](https://www.youtube.com/watch?v=dQw4w9WgXcQ "embed")'
    expect(renderNote(body)).not.toContain('<iframe')
    expect(renderNote(body, { embeds: true })).toContain(
      'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"',
    )
  })

  it('shows embeds of unknown sites as cards', () => {
    const html = renderNote('[x](https://evil.example/x "embed")', { embeds: true })
    expect(html).not.toContain('<iframe')
    expect(html).toContain('link-card')
  })

  it('leaves other links alone', () => {
    expect(renderNote('see [read](https://blog.example/a "card")')).not.toContain('link-card')
    expect(renderNote('[read](https://blog.example/a "A title")')).not.toContain('link-card')
    expect(renderNote('[read](javascript:alert(1) "card")')).not.toContain('link-card')
  })
})

describe('wikilinks on a public page', () => {
  const notes = noteTitleIndex([{ id: 'trip-plan', title: 'Trip plan' }])

  it('link published notes by their address', () => {
    const html = renderNote('[[Trip plan|the plan]]', { notes, isPublic: true })
    expect(html).toContain('<a class="wikilink" href="/p/trip-plan">the plan</a>')
    expect(html).not.toContain('data-note')
  })

  it('read as plain words when the note is not public', () => {
    const html = renderNote('see [[Diary]]', { notes, isPublic: true })
    expect(html).toBe('<p>see Diary</p>\n')
  })
})

describe('raw HTML in a note', () => {
  it('shows as text and never runs', () => {
    const html = renderNote('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
})
