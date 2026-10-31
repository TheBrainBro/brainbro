import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from './SettingsDialog'

function renderDialog(onClose = () => {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog onClose={onClose} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('SettingsDialog', () => {
  it('opens on the import page and switches between pages', async () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    expect(screen.getByRole('heading', { name: 'Export' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Create export' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderDialog(onClose)

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Settings' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
