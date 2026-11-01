import { createContext, useContext } from 'react'

/*
 * Notes link each other by title, as Obsidian does: `[[Title]]`,
 * `[[Title|text]]`, `[[Title#heading]]` (embeds, `![[…]]`, aren't links). A
 * title finds a note the way the graph does (`apps.items.titles` on the
 * server): saved titles first, then the ones untitled notes get from their
 * body, case-insensitive.
 */

/** A title a note answers to, in the order the server tries them. */
export type NoteTitle = { id: string; title: string }

/** Every wikilink in `text`; `heading` and `text` are null when not written. */
export const WIKILINK = /(?<!!)\[\[([^\]|#\n]+)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/g

export type Wikilink = {
  from: number
  to: number
  /** Where the target ends and the heading or text starts. */
  targetEnd: number
  target: string
  heading: string | null
  text: string | null
}

export function findWikilinks(text: string): Wikilink[] {
  return [...text.matchAll(WIKILINK)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
    targetEnd: match.index + 2 + match[1].length,
    target: match[1],
    heading: match[2] ?? null,
    text: match[3] ?? null,
  }))
}

/** What a link reads as: its text, or else the title and heading it points to. */
export function wikilinkLabel(link: Pick<Wikilink, 'target' | 'heading' | 'text'>) {
  if (link.text?.trim()) return link.text.trim()
  const target = link.target.trim()
  return link.heading?.trim() ? `${target} › ${link.heading.trim()}` : target
}

/** The title a link points to: `Folder/Title.md` and `Title` both mean Title. */
export function wikilinkTarget(target: string) {
  const name = target.trim().split('/').at(-1)!
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

const fold = (title: string) => title.toLowerCase()

/** Note ids by title; the first note with a title wins. */
export type NoteTitleIndex = Map<string, string>

export function noteTitleIndex(titles: NoteTitle[]): NoteTitleIndex {
  const index: NoteTitleIndex = new Map()
  for (const { id, title } of titles) if (!index.has(fold(title))) index.set(fold(title), id)
  return index
}

/** The id of the note `target` points to, if there is one. */
export function resolveWikilink(index: NoteTitleIndex, target: string) {
  return index.get(fold(wikilinkTarget(target))) ?? null
}

/** The user's note titles and how to open a note, for the editor and the viewer. */
export type NoteTitles = {
  titles: NoteTitle[]
  index: NoteTitleIndex
  open: (id: string) => void
}

export const NoteTitlesContext = createContext<NoteTitles | null>(null)

/** Null outside the app's layout: links then show without resolving. */
export function useNoteTitles() {
  return useContext(NoteTitlesContext)
}
