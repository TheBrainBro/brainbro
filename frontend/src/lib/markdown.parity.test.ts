import { describe, expect, it } from 'vitest'

import { noteTitleIndex } from '../notes/wikilinks'
import shared from '../../../backend/apps/public/tests/markdown_cases.json'
import emoji from '../../../backend/apps/public/emoji.json'
import messages from '../../../backend/apps/public/messages.json'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { emojiByName, emoticonsByName, renderNote } from './markdown'
import type { LinkPreview } from './linkPreviews'

/*
 * A blog's pages render notes on the server (`apps.public.note_html`). These
 * are the same cases its tests run, so the two can't drift apart.
 */

/** HTML as a browser reads it, attributes in order: how it's written doesn't count. */
function normalized(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  for (const element of root.querySelectorAll('*')) {
    const attributes = [...element.attributes].sort((a, b) => a.name.localeCompare(b.name))
    for (const { name } of attributes) element.removeAttribute(name)
    for (const { name, value } of attributes) {
      element.setAttribute(name, name === 'style' ? value.replace(/[\s;]/g, '') : value)
    }
  }
  return root.innerHTML
}

describe('the server renders notes as the app does', () => {
  const notes = noteTitleIndex(shared.notes.map(({ url, title }) => ({ id: url, title })))

  it.each(shared.cases)('$name', ({ body, html }) => {
    const rendered = renderNote(body, {
      images: shared.images,
      links: shared.links as Record<string, LinkPreview>,
      embeds: true,
      notes,
      isPublic: true,
    })
    expect(normalized(html)).toBe(normalized(rendered))
  })

  it('has the same emoji', () => {
    expect(emoji.defs).toEqual(emojiByName)
    const aliases = Object.fromEntries(
      Object.entries(emoticonsByName).map(([name, list]) => [name, [list].flat()]),
    )
    expect(emoji.shortcuts).toEqual(aliases)
  })

  it('uses the same words', () => {
    for (const [language, words] of [
      ['en', en],
      ['es', es],
    ] as const) {
      for (const section of ['public', 'markdown'] as const) {
        expect(words[section]).toMatchObject(messages[language][section])
      }
    }
  })
})
