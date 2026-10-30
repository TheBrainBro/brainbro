/** The note's first line as plain words: what a printed note is named. */
export function noteTitle(body: string) {
  const line = body.split('\n').find((candidate) => candidate.trim()) ?? ''
  const text = line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~=`]/g, '')
    .trim()
  return text.slice(0, 80).trim() || 'Note'
}
