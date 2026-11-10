import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CollectionPicker } from './CollectionPicker'

function collection(id: string, name: string, parent: string | null = null) {
  return {
    id,
    name,
    parent,
    is_sample: false,
    kind: 'area',
    color: '',
    icon: '',
    image_url: null,
    item_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const results = [
  collection('blog', 'Blog'),
  collection('projects', 'Projects'),
  collection('one', 'Simmers', 'blog'),
  collection('two', 'Simmers', 'projects'),
]

function setup() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ count: results.length, next: null, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const onConfirm = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CollectionPicker count={1} onConfirm={onConfirm} onClose={() => {}} />
    </QueryClientProvider>,
  )
  return { fetchMock, onConfirm }
}

/** The boxes in the list, in order: "Blog" also shows as a place, so not by text. */
function boxes() {
  return screen.getAllByRole('checkbox') as HTMLInputElement[]
}

async function loaded() {
  await screen.findAllByText('Blog')
  return screen.getByRole('textbox')
}

describe('CollectionPicker', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('leaves several collections with the same name to a click', async () => {
    const { fetchMock } = setup()
    const input = await loaded()

    fireEvent.change(input, { target: { value: 'simmers' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(boxes().map((box) => box.checked)).toEqual([false, false])
    const methods = fetchMock.mock.calls.map((call: unknown[]) => (call[1] as RequestInit)?.method)
    expect(methods).not.toContain('POST')

    fireEvent.click(boxes()[1])
    expect(boxes().map((box) => box.checked)).toEqual([false, true])
  })

  it('toggles the only collection with that name on Enter', async () => {
    setup()
    const input = await loaded()

    fireEvent.change(input, { target: { value: 'blog' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(boxes().map((box) => box.checked)).toEqual([true, false, false, false])
  })
})
