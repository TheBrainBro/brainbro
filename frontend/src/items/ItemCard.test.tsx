import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ItemCard } from './ItemCard'
import type { Item } from './api'

function fileItem(metadata: Item['metadata']): Item {
  return {
    id: 'f1',
    kind: 'file',
    status: 'inbox',
    title: metadata.filename ?? '',
    body: '',
    url: '',
    metadata,
    preview_status: '',
    preview_image_url: null,
    file_url: '/api/items/f1/file/?v=a',
    collections: [],
    version: 'v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: '',
    created_via: 'web',
    edited_by: '',
    edited_via: '',
    edited_at: null,
    public_slug: null,
    public_url: null,
    published_at: null,
  }
}

function renderCard(item: Item) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ItemCard item={item} />
    </QueryClientProvider>,
  )
}

describe('ItemCard files', () => {
  it('previews SVGs through an img, which runs no scripts', () => {
    renderCard(fileItem({ filename: 'logo.svg', mime: 'image/svg+xml', size: 2048 }))
    expect(screen.getByRole('img', { name: 'logo.svg' })).toHaveAttribute(
      'src',
      '/api/items/f1/file/?v=a',
    )
  })

  it('shows the first page of a PDF once it is rendered', () => {
    const pdf = { filename: 'Report.pdf', mime: 'application/pdf', size: 10 }
    const { unmount } = renderCard({ ...fileItem(pdf), preview_status: 'pending' })
    expect(screen.getByText('Making preview…')).toBeInTheDocument()
    unmount()

    renderCard({
      ...fileItem(pdf),
      preview_status: 'ready',
      preview_image_url: '/api/items/f1/preview-image/?v=p.webp',
    })
    expect(screen.getByRole('img', { name: 'Report.pdf' })).toHaveAttribute(
      'src',
      '/api/items/f1/preview-image/?v=p.webp',
    )
  })

  it('shows no preview for other files and truncates long names', () => {
    const name = `${'a'.repeat(120)}.pdf`
    renderCard(fileItem({ filename: name, mime: 'application/pdf', size: 10 }))
    expect(screen.queryByRole('img')).toBeNull()
    const link = screen.getByRole('link', { name })
    expect(link).toHaveClass('truncate')
    expect(link).toHaveAttribute('title', name)
  })
})

describe('ItemCard images', () => {
  it('shows the caption under the image', () => {
    renderCard({
      ...fileItem({ filename: 'IMG_0042.png', mime: 'image/png', width: 40, height: 20 }),
      kind: 'image',
      body: 'Whiteboard from the pricing workshop',
    })
    expect(screen.getByText('Whiteboard from the pricing workshop')).toBeInTheDocument()
  })
})

describe('ItemCard notes', () => {
  const note = (body: string): Item => ({
    ...fileItem({}),
    id: 'n1',
    kind: 'note',
    body,
    file_url: null,
  })

  it('renders the Markdown', () => {
    renderCard(note('# Plan\n\n- **one**\n- [x] done\n\n`code`'))
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByText('one').tagName).toBe('STRONG')
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('keeps sample status out of the card UI', () => {
    renderCard({ ...note('Try this'), is_sample: true })
    expect(screen.queryByText('Sample')).not.toBeInTheDocument()
  })

  it('shows raw HTML as text, never as markup', () => {
    const { container } = renderCard(
      note(
        '<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>bold</b>\n\n' +
          '<div onclick="x">block</div>',
      ),
    )
    expect(container.querySelector('img, script, b, div[onclick], [onerror]')).toBeNull()
    expect(container).toHaveTextContent('<b>bold</b>')
  })

  it('refuses javascript: links and opens the rest outside the app', () => {
    const { container } = renderCard(note('[bad](javascript:alert(1)) [good](https://example.com)'))
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    const good = screen.getByRole('link', { name: 'good' })
    expect(good).toHaveAttribute('href', 'https://example.com')
    expect(good).toHaveAttribute('target', '_blank')
    expect(good).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders the markdown-it plugins and typographer, like the editor', () => {
    const { container } = renderCard(
      note(
        'H~2~O 19^th^ ~~gone~~ ++new++ ==marked== :wink: 8-) (c) wait... -- "quoted"\n\n' +
          'Ref[^1].\n\n[^1]: The note.\n\nTerm\n: Definition\n\n' +
          'Uses HTML.\n\n*[HTML]: Hyper Text Markup Language\n\n' +
          '::: warning\nhere be dragons\n:::\n',
      ),
    )
    const text = (selector: string) => container.querySelector(selector)?.textContent
    expect(text('sub')).toBe('2')
    expect(text('sup:not(.footnote-ref)')).toBe('th')
    expect(text('s')).toBe('gone')
    expect(text('ins')).toBe('new')
    expect(text('mark')).toBe('marked')
    expect(container).toHaveTextContent('😉 😎 © wait… – “quoted”')
    expect(container.querySelector('.footnote-ref')).toBeInTheDocument()
    expect(text('.footnotes li')).toContain('The note.')
    expect(text('dt')).toBe('Term')
    expect(text('dd')).toBe('Definition')
    expect(container.querySelector('abbr')).toHaveAttribute('title', 'Hyper Text Markup Language')
    expect(text('.warning')?.trim()).toBe('here be dragons')
  })

  it('does not load remote images, showing their alt text', () => {
    renderCard(note('![a cat](https://tracker.example/cat.png)'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('a cat')).toBeInTheDocument()
  })
})

describe('ItemCard tasks', () => {
  it('ticks a task in the Markdown and saves it with the version it saw', async () => {
    const body = '> - [ ] quoted\n\n1. [ ] first\n2. [x] second\n   - [ ] nested\n'
    const item: Item = { ...fileItem({}), id: 'n1', kind: 'note', body, file_url: null }
    const patches: { body: string; ifMatch: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const sent = JSON.parse(String(init?.body))
        patches.push({ body: sent.body, ifMatch: new Headers(init?.headers).get('If-Match') })
        return new Response(JSON.stringify({ ...item, body: sent.body, version: 'v2' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    renderCard(item)

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((box) => (box as HTMLInputElement).checked)).toEqual([
      false,
      false,
      true,
      false,
    ])
    fireEvent.click(boxes[3])
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      body: body.replace('- [ ] nested', '- [x] nested'),
      ifMatch: '"v1"',
    })

    fireEvent.click(screen.getAllByRole('checkbox')[2])
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].body).toBe(body.replace('2. [x] second', '2. [ ] second'))
    vi.unstubAllGlobals()
  })
})

describe('ItemCard audio', () => {
  it('plays a recording in the card, with its caption', () => {
    const { container } = renderCard({
      ...fileItem({ filename: 'Voice note.webm', mime: 'audio/webm', size: 4096 }),
      kind: 'audio',
      body: 'Ideas for the trip',
    })
    expect(screen.getByText('Voice note.webm')).toBeInTheDocument()
    expect(screen.getByText('Ideas for the trip')).toBeInTheDocument()
    expect(screen.getByText('4 KB')).toBeInTheDocument()
    // On a board, using the player doesn't drag the card.
    expect(container.querySelector('audio')).toHaveAttribute('src', '/api/items/f1/file/?v=a')
    expect(container.querySelector('audio')!.parentElement).toHaveClass('nodrag')
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })
})
