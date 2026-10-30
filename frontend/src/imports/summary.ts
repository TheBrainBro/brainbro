import type { ImportCounts } from './api'

const NOUNS: [keyof ImportCounts, string, string][] = [
  ['notes', 'note', 'notes'],
  ['images', 'image', 'images'],
  ['files', 'file', 'files'],
  ['links', 'link', 'links'],
  ['boards', 'board', 'boards'],
  ['collections', 'collection', 'collections'],
]

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`
}

/** What an import created, as a sentence. */
export function summary(counts: Partial<ImportCounts>) {
  const parts = NOUNS.filter(([key]) => counts[key]).map(([key, one, many]) =>
    plural(counts[key] ?? 0, one, many),
  )
  const created = parts.length ? `Imported ${parts.join(', ')}.` : 'Nothing to import was found.'
  const skipped = counts.skipped
    ? ` ${plural(counts.skipped, 'file was', 'files were')} skipped (too large or unreadable).`
    : ''
  return created + skipped
}
