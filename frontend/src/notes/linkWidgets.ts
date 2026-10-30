import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Line } from '@codemirror/state'
import { WidgetType, type EditorView } from '@codemirror/view'

import type { NoteLinks } from '../items/api'
import {
  embedSrc,
  linkCardHtml,
  linkEmbedHtml,
  linkLine,
  type LinkPreview,
  type LinkView,
} from '../lib/linkPreviews'
import { imageKey } from '../lib/markdown'

/*
 * Links alone on their line can show as a card or an embed (lib/linkPreviews).
 * Away from the cursor such a line is the card or the player itself; hovering
 * any link line offers Link / Card / Embed, which rewrites the line.
 */

/** The previews of the note's card and embed links, by URL. */
export const setNoteLinks = StateEffect.define<NoteLinks>()

export const noteLinks = StateField.define<NoteLinks>({
  create: () => ({}),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setNoteLinks)) value = effect.value
    return value
  },
})

/** A line that is only a link, and how it shows. */
export type LinkLine = { url: string; label: string; view: LinkView }

const CHOSEN = /^\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\s+"(card|embed)"\)\s*$/
const LABELLED = /^\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)\s*$/
const BARE = /^<?(https?:\/\/[^\s<>]+?)>?\s*$/

const CODE = new Set(['FencedCode', 'CodeBlock', 'CodeText', 'HTMLBlock'])

export function linkLineAt(state: EditorState, line: Line): LinkLine | null {
  const text = line.text
  if (!text.includes('http')) return null
  let found: LinkLine | null = null
  let match
  if ((match = CHOSEN.exec(text))) found = { label: match[1], url: match[2], view: match[3] as LinkView }
  else if ((match = LABELLED.exec(text))) found = { label: match[1], url: match[2], view: 'link' }
  else if ((match = BARE.exec(text))) found = { label: match[1], url: match[1], view: 'link' }
  if (!found) return null
  for (let node = syntaxTree(state).resolveInner(line.from, 1); node; node = node.parent!) {
    if (CODE.has(node.name)) return null
    if (!node.parent) break
  }
  return found
}

function rewrite(view: EditorView, at: HTMLElement, link: LinkLine, choice: LinkView) {
  const line = view.state.doc.lineAt(view.posAtDOM(at))
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: linkLine(link.url, link.label, choice) },
    userEvent: 'input.link-view',
  })
}

/** Link / Card / Embed, for the link on this line. */
function switcher(view: EditorView, link: LinkLine) {
  const bar = document.createElement('span')
  bar.className = 'cm-link-switch'
  bar.setAttribute('role', 'group')
  bar.setAttribute('aria-label', 'Show link as')
  const choices: LinkView[] = embedSrc(link.url) ? ['link', 'card', 'embed'] : ['link', 'card']
  for (const choice of choices) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = choice[0].toUpperCase() + choice.slice(1)
    button.setAttribute('aria-pressed', String(choice === link.view))
    // Keep the cursor where it is: choosing isn't editing.
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', (event) => {
      event.preventDefault()
      if (choice !== link.view) rewrite(view, bar, link, choice)
    })
    bar.append(button)
  }
  return bar
}

/** The switcher at the end of a link line being shown as text. */
export class LinkSwitchWidget extends WidgetType {
  readonly link: LinkLine
  constructor(link: LinkLine) {
    super()
    this.link = link
  }
  eq(other: LinkSwitchWidget) {
    return (
      other.link.url === this.link.url &&
      other.link.label === this.link.label &&
      other.link.view === this.link.view
    )
  }
  toDOM(view: EditorView) {
    return switcher(view, this.link)
  }
  ignoreEvent() {
    return true
  }
}

/** The card or the player, in place of its line. */
export class LinkPreviewWidget extends WidgetType {
  readonly link: LinkLine
  readonly preview: LinkPreview | null
  constructor(link: LinkLine, preview: LinkPreview | null) {
    super()
    this.link = link
    this.preview = preview
  }
  eq(other: LinkPreviewWidget) {
    return (
      other.link.url === this.link.url &&
      other.link.label === this.link.label &&
      other.link.view === this.link.view &&
      JSON.stringify(other.preview) === JSON.stringify(this.preview)
    )
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-link-preview'
    const { url, label } = this.link
    // Built from escaped text, and players only from known sites.
    box.innerHTML =
      this.link.view === 'embed'
        ? linkEmbedHtml(url, label, this.preview)
        : linkCardHtml(url, label, this.preview)
    const card = box.querySelector('a')
    card?.addEventListener('click', (event) => {
      // Mod-click opens it, as with links in the text; a click edits the line.
      if (event.metaKey || event.ctrlKey) return
      event.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(box))
      view.dispatch({ selection: { anchor: line.to } })
      view.focus()
    })
    box.querySelector('img')?.addEventListener('load', () => view.requestMeasure())
    box.append(switcher(view, this.link))
    return box
  }
  ignoreEvent() {
    return true
  }
}

/** The stored preview of a link, by its URL as markdown-it reads it. */
export function previewOf(state: EditorState, url: string) {
  return state.field(noteLinks, false)?.[imageKey(url)] ?? null
}
