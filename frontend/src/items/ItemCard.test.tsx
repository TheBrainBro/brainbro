import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
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

  it('never renders raw HTML', () => {
    const { container } = renderCard(
      note(
        '<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>bold</b>\n\n' +
          '<div onclick="x">block</div>',
      ),
    )
    expect(container.querySelector('img, script, b, div[onclick]')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
    expect(screen.getByText(/bold/)).toBeInTheDocument()
  })

  it('drops javascript: links and opens the rest outside the app', () => {
    renderCard(note('[bad](javascript:alert(1)) [good](https://example.com)'))
    expect(screen.getByText('bad')).not.toHaveAttribute(
      'href',
      expect.stringContaining('javascript'),
    )
    const good = screen.getByRole('link', { name: 'good' })
    expect(good).toHaveAttribute('href', 'https://example.com')
    expect(good).toHaveAttribute('target', '_blank')
    expect(good).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not load remote images, showing their alt text', () => {
    renderCard(note('![a cat](https://tracker.example/cat.png)'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('a cat')).toBeInTheDocument()
  })
})
