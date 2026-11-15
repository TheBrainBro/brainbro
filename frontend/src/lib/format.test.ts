import { describe, expect, it } from 'vitest'

import { formatBytes } from './format'

const MB = 1024 * 1024

describe('formatBytes', () => {
  it.each([
    [500, '500 B'],
    [1536, '1.5 KB'],
    [300 * MB, '300 MB'],
    [1024 * MB, '1 GB'],
    [1536 * MB, '1.5 GB'],
    // Just under a unit rounds up into it, not to "1024".
    [1024 * MB - 232448, '1 GB'],
    [1024 * 1024 - 100, '1 MB'],
  ])('%i bytes read as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})
