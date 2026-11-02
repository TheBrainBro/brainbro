const FENCE = /^\s*(```|~~~)/
const HEADING = /^ {0,3}#\s+\S/

function firstHeading(lines: string[]) {
  let inCode = false
  for (const line of lines) {
    if (FENCE.test(line)) inCode = !inCode
    else if (!inCode && HEADING.test(line)) return line
  }
}

/**
 * A note's name, from its body: the first H1, or else its first line, as plain
 * words. What a printed note is named, and what an untitled note is called.
 */
export function noteTitle(body: string, fallback = 'Note') {
  const lines = body.split('\n')
  const line = firstHeading(lines) ?? lines.find((candidate) => candidate.trim()) ?? ''
  const text = line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`]/g, '')
    .trim()
  return text.slice(0, 80).trim() || fallback
}
