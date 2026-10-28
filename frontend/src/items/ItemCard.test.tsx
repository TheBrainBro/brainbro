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

  it('shows no preview for other files and truncates long names', () => {
    const name = `${'a'.repeat(120)}.pdf`
    renderCard(fileItem({ filename: name, mime: 'application/pdf', size: 10 }))
    expect(screen.queryByRole('img')).toBeNull()
    const link = screen.getByRole('link', { name })
    expect(link).toHaveClass('truncate')
    expect(link).toHaveAttribute('title', name)
  })
})
