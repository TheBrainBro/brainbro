import { afterEach, describe, expect, it } from 'vitest'

import { linkEmbedHtml, sizeEmbeddedPosts } from './linkPreviews'

describe('sizeEmbeddedPosts', () => {
  sizeEmbeddedPosts()

  afterEach(() => document.body.replaceChildren())

  function post() {
    document.body.innerHTML = linkEmbedHtml('https://x.com/jack/status/20', 'post')
    return document.querySelector('iframe')!
  }

  function report(frame: HTMLIFrameElement, data: unknown, origin = 'http://embed.testserver') {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }))
  }

  it('fits a post to the height its page reports', () => {
    const frame = post()
    report(frame, { type: 'brainbro:embed-height', height: 412 })
    expect(frame.style.height).toBe('412px')
  })

  it('ignores heights from anywhere but the post\'s own page', () => {
    const frame = post()
    report(frame, { type: 'brainbro:embed-height', height: 412 }, 'https://evil.example')
    report(frame, { type: 'brainbro:embed-height', height: '412' })
    report(frame, { type: 'other', height: 412 })
    expect(frame.style.height).toBe('')
  })

  it('caps the height', () => {
    const frame = post()
    report(frame, { type: 'brainbro:embed-height', height: 1e9 })
    expect(frame.style.height).toBe('4000px')
  })
})
