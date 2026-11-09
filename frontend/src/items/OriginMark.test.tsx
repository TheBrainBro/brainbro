import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Item } from './api'
import { OriginMark } from './OriginMark'

const item = {
  created_at: '2026-01-01T00:00:00Z',
  created_by: '',
  created_logo: '',
  edited_by: '',
  edited_logo: '',
  edited_at: null,
} as Item

function shown(container: HTMLElement) {
  return container.querySelector('svg')?.getAttribute('aria-label')
}

describe('OriginMark', () => {
  it('shows the logo of the assistant that added it', () => {
    const { container } = render(<OriginMark item={{ ...item, created_by: 'Cursor', created_logo: 'cursor' }} />)

    expect(shown(container)).toBe('Cursor')
    expect(screen.getByText(/^Added by Cursor/, { selector: '.sr-only' })).toBeInTheDocument()
  })

  it('shows the last assistant to edit it', () => {
    const { container } = render(
      <OriginMark
        item={{
          ...item,
          created_by: 'Cursor',
          created_logo: 'cursor',
          edited_by: 'Grok Bot',
          edited_logo: 'grokbot',
          edited_at: '2026-01-02T00:00:00Z',
        }}
      />,
    )

    expect(shown(container)).toBe('Grok Bot')
  })

  it('keeps the logo of who added it after the user edits it', () => {
    const { container } = render(
      <OriginMark
        item={{ ...item, created_by: 'Claude', created_logo: 'claude', edited_at: '2026-01-02T00:00:00Z' }}
      />,
    )

    expect(shown(container)).toBe('Claude')
  })

  it('falls back to the generic icon', () => {
    const { container } = render(<OriginMark item={{ ...item, created_by: 'My script' }} />)

    expect(shown(container)).toBeNull()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows nothing on what only the user touched', () => {
    const { container } = render(<OriginMark item={item} />)

    expect(container).toBeEmptyDOMElement()
  })
})
