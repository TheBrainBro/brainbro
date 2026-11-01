import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

import { GlyphWidget } from './dialect'
import {
  findWikilinks,
  noteTitleIndex,
  resolveWikilink,
  type NoteTitle,
  type NoteTitleIndex,
} from './wikilinks'

/*
 * `[[Title]]` links in the editor: away from the cursor they read as their
 * text in the link color (muted when no note has that title), Mod-click opens
 * the note, and typing `[[` suggests notes by title.
 */

type Titles = { titles: NoteTitle[]; index: NoteTitleIndex }

/** The user's note titles; without them links show and nothing is suggested. */
export const setNoteTitles = StateEffect.define<NoteTitle[]>()

export const noteTitles = StateField.define<Titles | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setNoteTitles)) value = { titles: effect.value, index: noteTitleIndex(effect.value) }
    }
    return value
  },
})

/** Opens a note by id. */
const openNote = Facet.define<(id: string) => void, ((id: string) => void) | null>({
  combine: (values) => values[0] ?? null,
})

const CODE = new Set(['InlineCode', 'CodeText', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'Comment'])

function inCode(state: EditorState, pos: number) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (CODE.has(node.name)) return true
    if (!node.parent) break
  }
  return false
}

/**
 * The live preview of the note's wikilinks, outside `skipLines` (code
 * blocks, tables, cards). Their ranges join `excluded`, so the dialect's
 * text rules leave titles as written.
 */
export function wikilinkDecorations(
  state: EditorState,
  scan: {
    excluded: { from: number; to: number }[]
    skipLines: Set<number>
    touches: (from: number, to: number) => boolean
  },
) {
  const decorations: Range<Decoration>[] = []
  const index = state.field(noteTitles, false)?.index
  const hide = Decoration.replace({})
  for (let number = 1; number <= state.doc.lines; number++) {
    if (scan.skipLines.has(number)) continue
    const line = state.doc.line(number)
    if (!line.text.includes('[[')) continue
    for (const link of findWikilinks(line.text)) {
      const from = line.from + link.from
      const to = line.from + link.to
      if (inCode(state, from)) continue
      scan.excluded.push({ from, to })
      const resolved = index ? resolveWikilink(index, link.target) !== null : true
      const mark = Decoration.mark({
        class: resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-unresolved',
        attributes: resolved ? {} : { title: 'No note with this title' },
      })
      if (scan.touches(from, to)) {
        decorations.push(mark.range(from + 2, to - 2))
        continue
      }
      const target = line.from + link.targetEnd
      if (link.text?.trim()) {
        // `[[Title|text]]` reads as `text`.
        const text = to - 2 - link.text.length
        decorations.push(hide.range(from, text), mark.range(text, to - 2))
      } else {
        // `[[Title#heading]]` reads as `Title › heading`; an empty `|` goes.
        const end = link.text === null ? to - 2 : to - 3 - link.text.length
        decorations.push(hide.range(from, from + 2), mark.range(from + 2, end))
        if (link.heading?.trim()) {
          decorations.push(
            Decoration.replace({ widget: new GlyphWidget(' › ', 'cm-wikilink') }).range(
              target,
              target + 1,
            ),
          )
        } else if (link.heading !== null) {
          decorations.push(hide.range(target, end))
        }
        if (end < to - 2) decorations.push(hide.range(end, to - 2))
      }
      decorations.push(hide.range(to - 2, to))
    }
  }
  return decorations
}

/** Mod-click on a link to a note opens it (a plain click edits it). */
function follow(event: MouseEvent, view: EditorView) {
  if (!(event.metaKey || event.ctrlKey)) return false
  const open = view.state.facet(openNote)
  const index = view.state.field(noteTitles, false)?.index
  const pos = view.posAtCoords(event)
  if (!open || !index || pos === null) return false
  const line = view.state.doc.lineAt(pos)
  const link = findWikilinks(line.text).find(
    (candidate) => line.from + candidate.from <= pos && pos <= line.from + candidate.to,
  )
  const id = link && resolveWikilink(index, link.target)
  if (!id) return false
  event.preventDefault()
  open(id)
  return true
}

// Titles a link can't hold: they would end it early.
const UNLINKABLE = /[[\]|#\n]/

/** After `[[`, the notes whose title matches what is typed. */
export function suggestNotes(context: CompletionContext): CompletionResult | null {
  const typed = context.matchBefore(/(?<!!)\[\[[^\]|#\n]*/)
  const titles = context.state.field(noteTitles, false)?.titles
  if (!typed || !titles || inCode(context.state, typed.from)) return null
  const seen = new Set<string>()
  const options: Completion[] = []
  for (const { title } of titles) {
    const key = title.toLowerCase()
    if (seen.has(key) || UNLINKABLE.test(title)) continue
    seen.add(key)
    options.push({ label: title, apply: complete(title) })
  }
  return { from: typed.from + 2, options, validFor: /^[^\]|#\n]*$/ }
}

/** Puts the title in and closes the link, over a `]]` already there. */
function complete(title: string) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const end = view.state.sliceDoc(to, to + 2) === ']]' ? to + 2 : to
    const insert = `${title}]]`
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
      annotations: pickedCompletion.of(completion),
      userEvent: 'input.complete',
    })
  }
}

/** Note titles to resolve and suggest (`setNoteTitles`), and how to open a note. */
export function wikilinks(open: (id: string) => void, titles: NoteTitle[] | null): Extension {
  return [
    titles ? noteTitles.init(() => ({ titles, index: noteTitleIndex(titles) })) : noteTitles,
    openNote.of(open),
    autocompletion({ override: [suggestNotes], icons: false }),
    EditorView.domEventHandlers({ mousedown: follow }),
    EditorView.theme({
      // Brackets parse as links without a URL (`cm-md-plain`): nested either way.
      '.cm-wikilink, .cm-wikilink :is(.cm-md-plain, .cm-md-link), .cm-md-plain .cm-wikilink': {
        color: 'var(--md-link)',
      },
      '.cm-wikilink-unresolved, .cm-wikilink-unresolved :is(.cm-md-plain, .cm-md-link), .cm-md-plain .cm-wikilink-unresolved':
        { color: 'var(--md-muted)', textDecoration: 'underline dashed', textUnderlineOffset: '0.2em' },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        background: 'var(--md-popover)',
        color: 'var(--md-text)',
        border: '1px solid var(--md-rule)',
        borderRadius: '0.5rem',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': { maxHeight: '15rem' },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '0.25rem 0.75rem' },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        background: 'var(--md-subtle)',
        color: 'var(--md-text)',
      },
      '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
    }),
  ]
}
