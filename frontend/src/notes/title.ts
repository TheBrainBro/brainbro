/**
 * A note's name, from its body: its first line, as plain words. What a printed
 * note is named, and what an untitled note is called.
 */
export function noteTitle(body: string, fallback = 'Note') {
  const line = body.split('\n').find((candidate) => candidate.trim()) ?? ''
  const text = line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`]/g, '')
    .trim()
  return text.slice(0, 80).trim() || fallback
}
