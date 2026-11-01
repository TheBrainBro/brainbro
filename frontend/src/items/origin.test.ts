import { describe, expect, it } from 'vitest'

import type { Item } from './api'
import { byAssistant, originText } from './origin'

const now = Date.parse('2026-11-01T12:00:00Z')

function item(fields: Partial<Item>) {
  return {
    created_at: '2026-10-29T12:00:00Z',
    created_by: '',
    created_via: 'web',
    edited_by: '',
    edited_via: '',
    edited_at: null,
    ...fields,
  } as Item
}

describe('originText', () => {
  it('says nothing for items only the user touched', () => {
    const mine = item({ edited_at: '2026-11-01T10:00:00Z', edited_via: 'web' })
    expect(byAssistant(mine)).toBe(false)
    expect(originText(mine, now)).toBeNull()
  })

  it('names the assistant that added or edited it, and when', () => {
    expect(originText(item({ created_by: 'ChatGPT' }), now)).toBe('Added by ChatGPT, 3 days ago')
    expect(
      originText(item({ edited_by: 'Claude', edited_at: '2026-11-01T10:00:00Z' }), now),
    ).toBe('Edited by Claude, 2 hours ago')
  })

  it('says the user edited what an assistant added', () => {
    const edited = item({ created_by: 'Claude', edited_at: '2026-11-01T11:00:00Z' })
    expect(byAssistant(edited)).toBe(true)
    expect(originText(edited, now)).toBe('Added by Claude · Edited by you, 1 hour ago')
  })
})
