import type { EditorState, Range } from '@codemirror/state'
import { Decoration, WidgetType } from '@codemirror/view'

import { CONTAINERS, emojiByName, emoticonsByName } from '../lib/markdown'

/*
 * The parts of the notes' dialect (lib/markdown, markdown-it's) that the
 * editor's parser doesn't know: typographer, emoticons, ++ins++, ==mark==,
 * abbreviations, definition lists and ::: containers. Rendered over the
 * text with decorations, like the rest of the live preview; the text itself
 * is never changed.
 */

/** Text shown in place of other text: `©` for `(c)`, `😎` for `8-)`. */
export class GlyphWidget extends WidgetType {
  readonly text: string
  readonly className: string
  constructor(text: string, className = '') {
    super()
    this.text = text
    this.className = className
  }
  eq(other: GlyphWidget) {
    return other.text === this.text && other.className === this.className
  }
  toDOM() {
    const glyph = document.createElement('span')
    if (this.className) glyph.className = this.className
    glyph.textContent = this.text
    return glyph
  }
}

const quote = (text: string) => text.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&')

// Emoticons as markdown-it-emoji knows them, longest first.
const emoticons = new Map<string, string>()
for (const [name, aliases] of Object.entries(emoticonsByName)) {
  const emoji = emojiByName[name]
  if (emoji) for (const alias of aliases) emoticons.set(alias, emoji)
}
const EMOTICON = new RegExp([...emoticons.keys()].sort().reverse().map(quote).join('|'), 'g')
// markdown-it-emoji only takes emoticons between spaces or punctuation.
const BOUNDARY = /[\p{Z}\p{P}\p{Cc}]/u

// markdown-it's typographer replacements, one alternation scanned left to right.
const TYPOGRAPHER =
  /\((?:c|tm|r)\)|\+-|[?!]\.{2,}|\.{2,}|[?!]{4,}|,{2,}|(?<!-)---(?!-)|(?<![^\s])--(?![^\s])|(?<=[^-\s])--(?=[^-\s]|$)/gi
const SCOPED: Record<string, string> = { '(c)': '©', '(r)': '®', '(tm)': '™' }

function typographer(match: string) {
  const scoped = SCOPED[match.toLowerCase()]
  if (scoped) return scoped
  if (match === '+-') return '±'
  if (/^[?!]\.+$/.test(match)) return `${match[0]}..`
  if (/^\.+$/.test(match)) return '…'
  if (/^[?!]+$/.test(match)) return match.at(-1)!.repeat(3)
  if (/^,+$/.test(match)) return ','
  return match === '---' ? '—' : '–'
}

// Straight quotes curl like markdown-it's smartquotes: opening after a space
// or bracket, an apostrophe between letters, closing otherwise.
const QUOTE = /["']/g
function smartQuote(text: string, index: number) {
  const before = index > 0 ? text[index - 1] : ' '
  const after = text[index + 1] ?? ' '
  const opening = /[\s([{—–-]/.test(before)
  if (text[index] === '"') return opening ? '“' : '”'
  if (/[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) return '’'
  return opening ? '‘' : '’'
}

const INS = /\+\+(?=\S)(.*?\S)\+\+/g
const MARK = /==(?=\S)(.*?\S)==/g
const ABBR_DEFINITION = /^\*\[([^\]]+)\]:[ \t]*(.*)$/
const DEFINITION = /^( {0,3})([:~])[ \t]+/
const CONTAINER_OPEN = new RegExp(`^:::[ \\t]*(${CONTAINERS.join('|')})\\b`)
const CONTAINER_CLOSE = /^:::[ \t]*$/

type Scan = {
  /** Ranges that already mean something (code, URLs, markers): left alone. */
  excluded: { from: number; to: number }[]
  /** Lines inside code blocks or tables. */
  skipLines: Set<number>
  touches: (from: number, to: number) => boolean
}

export function dialectDecorations(state: EditorState, scan: Scan) {
  const decorations: Range<Decoration>[] = []
  const { excluded, skipLines, touches } = scan
  const overlaps = (from: number, to: number) =>
    excluded.some((range) => range.from < to && range.to > from)
  const hide = Decoration.replace({})
  const lineDeco = (pos: number, className: string) =>
    decorations.push(Decoration.line({ class: className }).range(pos))

  // Line structure first: abbreviation definitions, definition lists and
  // containers, whose markers the inline scan must not touch.
  const abbreviations = new Map<string, string>()
  let container: string | null = null
  // Definition lists: the candidate term line, whether the last text line
  // was a definition, and blank lines since the last text line (one may sit
  // between a term and its definition).
  let term: number | null = null
  let inDefinition = false
  let blanks = 0

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (skipLines.has(number)) {
      term = null
      inDefinition = false
      continue
    }
    const active = touches(line.from, line.to)

    const opening = CONTAINER_OPEN.exec(line.text)
    if (!container && opening) {
      container = opening[1]
      lineDeco(line.from, `cm-md-container cm-md-container-${container} cm-md-container-first`)
      if (!active) {
        decorations.push(
          Decoration.replace({ widget: new GlyphWidget(container, 'cm-md-codelang') }).range(
            line.from,
            line.to,
          ),
        )
      }
      excluded.push({ from: line.from, to: line.to })
      continue
    }
    if (container) {
      const closing = CONTAINER_CLOSE.test(line.text)
      lineDeco(
        line.from,
        `cm-md-container cm-md-container-${container}${closing ? ' cm-md-container-last' : ''}`,
      )
      if (closing) {
        if (!active) decorations.push(hide.range(line.from, line.to))
        excluded.push({ from: line.from, to: line.to })
        container = null
        continue
      }
    }

    const abbreviation = ABBR_DEFINITION.exec(line.text)
    if (abbreviation) {
      abbreviations.set(abbreviation[1], abbreviation[2])
      if (!active)
        decorations.push(Decoration.mark({ class: 'cm-md-refdef' }).range(line.from, line.to))
      excluded.push({ from: line.from, to: line.to })
      term = null
      inDefinition = false
      continue
    }

    if (!line.text.trim()) {
      blanks++
      if (blanks > 1) term = null
      continue
    }
    const afterBlank = blanks > 0
    blanks = 0

    const definition = DEFINITION.exec(line.text)
    if (definition && (term !== null || inDefinition)) {
      if (term !== null) lineDeco(state.doc.line(term).from, 'cm-md-dt')
      term = null
      lineDeco(line.from, 'cm-md-dd')
      // The marker and its indent; the line's padding stands in for them.
      const end = line.from + definition[0].length
      if (!active) decorations.push(hide.range(line.from, end))
      excluded.push({ from: line.from, to: end })
      inDefinition = true
      continue
    }
    if (inDefinition && !afterBlank) {
      // Lazy continuation of the definition above.
      lineDeco(line.from, 'cm-md-dd')
      continue
    }
    inDefinition = false
    // Plain text could be a term, if a definition follows.
    term = /^\s*(?:#|>|[-*+]\s|\d+[.)]\s|\|)/.test(line.text) ? null : number
  }

  // Inline: ++ins++ and ==mark==, then single glyphs.
  for (let number = 1; number <= state.doc.lines; number++) {
    if (skipLines.has(number)) continue
    const line = state.doc.line(number)
    for (const [pattern, className] of [
      [INS, 'cm-md-ins'],
      [MARK, 'cm-md-highlight'],
    ] as const) {
      for (const match of line.text.matchAll(pattern)) {
        const from = line.from + match.index
        const to = from + match[0].length
        if (overlaps(from, to)) continue
        decorations.push(Decoration.mark({ class: className }).range(from + 2, to - 2))
        if (!touches(from, to)) decorations.push(hide.range(from, from + 2), hide.range(to - 2, to))
        excluded.push({ from, to: from + 2 }, { from: to - 2, to })
      }
    }

    for (const [label, title] of abbreviations) {
      const word = new RegExp(`(?<![\\p{L}\\p{N}])${quote(label)}(?![\\p{L}\\p{N}])`, 'gu')
      for (const match of line.text.matchAll(word)) {
        const from = line.from + match.index
        const to = from + label.length
        if (overlaps(from, to)) continue
        decorations.push(
          Decoration.mark({ class: 'cm-md-abbr', attributes: { title } }).range(from, to),
        )
      }
    }

    const glyphs: { from: number; to: number; text: string }[] = []
    for (const match of line.text.matchAll(EMOTICON)) {
      const end = match.index + match[0].length
      const before = match.index === 0 || BOUNDARY.test(line.text[match.index - 1])
      const after = end === line.text.length || BOUNDARY.test(line.text[end])
      if (!before || !after) continue
      glyphs.push({
        from: line.from + match.index,
        to: line.from + end,
        text: emoticons.get(match[0])!,
      })
    }
    for (const match of line.text.matchAll(TYPOGRAPHER)) {
      const from = line.from + match.index
      glyphs.push({ from, to: from + match[0].length, text: typographer(match[0]) })
    }
    for (const match of line.text.matchAll(QUOTE)) {
      const from = line.from + match.index
      glyphs.push({ from, to: from + 1, text: smartQuote(line.text, match.index) })
    }
    glyphs.sort((a, b) => a.from - b.from || b.to - a.to)
    let end = -1
    for (const glyph of glyphs) {
      if (glyph.from < end || overlaps(glyph.from, glyph.to) || touches(glyph.from, glyph.to)) {
        continue
      }
      end = glyph.to
      decorations.push(
        Decoration.replace({ widget: new GlyphWidget(glyph.text) }).range(glyph.from, glyph.to),
      )
    }
  }
  return decorations
}
