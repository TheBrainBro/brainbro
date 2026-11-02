import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { noteTitleIndex, NoteTitlesContext } from '../notes/wikilinks'
import { Markdown } from './Markdown'

describe('Markdown wikilinks', () => {
  it('open the note they point to, then call onFollow', () => {
    const titles = [{ id: 'n1', title: 'Plan' }]
    const open = vi.fn()
    const onFollow = vi.fn()
    const card = vi.fn()
    render(
      <NoteTitlesContext value={{ titles, index: noteTitleIndex(titles), open }}>
        <div onClick={card}>
          <Markdown onFollow={onFollow}>{'See [[plan|the plan]] and [[Nowhere]]'}</Markdown>
        </div>
      </NoteTitlesContext>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'the plan' }))

    expect(open).toHaveBeenCalledWith('n1')
    expect(onFollow).toHaveBeenCalled()
    expect(card).not.toHaveBeenCalled()
    expect(screen.getByText('Nowhere')).toHaveClass('wikilink-unresolved')
  })
})
