import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyTheme } from './theme'

function barColors() {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map(
    (meta) => [meta.getAttribute('media'), meta.content],
  )
}

beforeEach(() => {
  // As in index.html: one color per scheme while following the system.
  document.head.innerHTML = `
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
  `
})

afterEach(() => {
  applyTheme('system')
  document.head.innerHTML = ''
})

describe('applyTheme', () => {
  it('paints the browser bar dark for the dark theme, whatever the system says', () => {
    applyTheme('dark')

    expect(barColors()).toEqual([
      ['(prefers-color-scheme: light)', '#09090b'],
      ['(prefers-color-scheme: dark)', '#09090b'],
    ])
  })

  it('paints the browser bar light for the light theme', () => {
    applyTheme('light')

    expect(barColors()).toEqual([
      ['(prefers-color-scheme: light)', '#ffffff'],
      ['(prefers-color-scheme: dark)', '#ffffff'],
    ])
  })

  it('leaves the browser bar to the system again when the theme is system', () => {
    applyTheme('dark')

    applyTheme('system')

    expect(barColors()).toEqual([
      ['(prefers-color-scheme: light)', '#ffffff'],
      ['(prefers-color-scheme: dark)', '#09090b'],
    ])
  })
})
