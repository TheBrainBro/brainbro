import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyLanguage, browserLanguage, currentLanguage, rich, t } from './i18n'
import { en } from './en'
import { es } from './es'

/** Every key under `messages`, dotted, down to the strings and plurals. */
function keysOf(messages: object, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' || 'other' in value
      ? [`${prefix}${key}`]
      : keysOf(value, `${prefix}${key}.`),
  )
}

/** The `{name}` and `<tag>` a message takes, to compare a translation with English. */
function slots(message: string | object) {
  const text = typeof message === 'string' ? message : Object.values(message).join(' ')
  return [...new Set(text.match(/\{\w+\}|<\w+>/g))].sort()
}

function lookup(messages: object, key: string) {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages) as
    | string
    | object
}

afterEach(() => {
  applyLanguage('system')
  vi.unstubAllGlobals()
})

describe('t', () => {
  it('fills in values', () => {
    expect(t('collections.created', { name: 'Work' })).toBe('Created Work')
  })

  it('picks the plural form by count, in the language shown', () => {
    expect(t('counts.items', { count: 1 })).toBe('1 item')
    expect(t('counts.items', { count: 3 })).toBe('3 items')
    applyLanguage('es')
    expect(t('counts.items', { count: 1 })).toBe('1 elemento')
    expect(t('counts.items', { count: 3 })).toBe('3 elementos')
  })

  it('writes numbers the way the language does', () => {
    applyLanguage('es')
    expect(t('counts.items', { count: 12000 })).toBe('12.000 elementos')
  })
})

describe('rich', () => {
  it('puts nodes in the message, tags and values alike', () => {
    render(
      <p data-testid="message">
        {rich('auth.signedInAs', { username: 'ana', b: (chunk) => <strong>{chunk}</strong> })}
      </p>,
    )
    expect(screen.getByTestId('message')).toHaveTextContent('signed in as ana. Sign out')
    expect(screen.getByText('ana').tagName).toBe('STRONG')
  })
})

describe('language', () => {
  it("follows the browser's first language the app speaks", () => {
    vi.stubGlobal('navigator', { ...navigator, languages: ['fr-FR', 'es-AR', 'en'] })
    expect(browserLanguage()).toBe('es')
  })

  it('falls back to English when the browser speaks none of them', () => {
    vi.stubGlobal('navigator', { ...navigator, languages: ['fr-FR', 'de'] })
    expect(browserLanguage()).toBe('en')
  })

  it('shows the language chosen and remembers it on this device', () => {
    applyLanguage('es')
    expect(currentLanguage()).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(localStorage.getItem('brain:language')).toBe('es')

    applyLanguage('system')
    expect(localStorage.getItem('brain:language')).toBeNull()
  })
})

describe('Spanish', () => {
  it('has every English key, and no others', () => {
    expect(keysOf(es).sort()).toEqual(keysOf(en).sort())
  })

  it('takes the same values and markup as English in every message', () => {
    for (const key of keysOf(en)) {
      expect(slots(lookup(es, key)), key).toEqual(slots(lookup(en, key)))
    }
  })
})
