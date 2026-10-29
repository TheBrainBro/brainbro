/** A piece of text, marked if it matches one of the search words. */
export type Segment = { text: string; match: boolean }

/** Lowercase and without accents, like the server compares. */
export function normalize(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function searchWords(query: string) {
  return normalize(query).split(/\s+/).filter(Boolean)
}

/**
 * Where each word appears in `text`, ignoring case and accents, as
 * [start, end) ranges of the original text, merged and in order.
 */
export function matchRanges(text: string, words: string[]) {
  // Normalized text, and where each of its characters came from.
  let plain = ''
  const from: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = normalize(text[i])
    plain += piece
    for (let j = 0; j < piece.length; j++) from.push(i)
  }
  const ranges: [number, number][] = []
  for (const word of words) {
    for (let at = plain.indexOf(word); at !== -1; at = plain.indexOf(word, at + word.length)) {
      ranges.push([from[at], from[at + word.length - 1] + 1])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push(range)
  }
  return merged
}

/** `text` cut into matching and plain pieces. */
export function highlight(text: string, words: string[]): Segment[] {
  const segments: Segment[] = []
  let at = 0
  for (const [start, end] of matchRanges(text, words)) {
    if (start > at) segments.push({ text: text.slice(at, start), match: false })
    segments.push({ text: text.slice(start, end), match: true })
    at = end
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false })
  return segments
}

/**
 * About `length` characters of `text` around its first match, on one line,
 * or null if no word appears as written (a typo matched instead).
 */
export function snippet(text: string, words: string[], length = 120) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const first = matchRanges(flat, words)[0]
  if (!first) return null
  let start = Math.max(0, first[0] - Math.floor(length / 3))
  // Start on a word, not halfway through one.
  const space = start > 0 ? flat.indexOf(' ', start) : -1
  if (space !== -1 && space < first[0]) start = space + 1
  const end = Math.min(flat.length, start + length)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}
