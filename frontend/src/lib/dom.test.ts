import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText, randomId } from './dom'

describe('randomId', () => {
  it('works where crypto.randomUUID does not exist', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/)
    expect(randomId()).not.toBe(randomId())
  })
})

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'clipboard')
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('uses the clipboard API when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await copyText('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to a hidden field over plain HTTP, and leaves nothing behind', async () => {
    let selected = ''
    const execCommand = vi.fn(() => {
      selected = (document.activeElement as HTMLTextAreaElement).value
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })
    await copyText('hello')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(selected).toBe('hello')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('fails when the browser refuses to copy', async () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
    await expect(copyText('hello')).rejects.toThrow()
  })
})
