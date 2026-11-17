import { t } from '../i18n/i18n'
import type { ImportCounts, ImportSource } from './api'

const NOUNS = ['notes', 'images', 'files', 'links', 'albums', 'boards', 'collections'] as const

/** What an import created, as a sentence. */
export function summary(counts: Partial<ImportCounts>, source: ImportSource = 'obsidian') {
  const parts = NOUNS.filter((key) => counts[key]).map((key) =>
    t(`counts.${key}`, { count: counts[key] ?? 0 }),
  )
  const created = parts.length
    ? t('imports.imported', { what: parts.join(', ') })
    : t('imports.nothing')
  const existing = counts.existing
    ? ` ${t('imports.existing', { count: counts.existing })}`
    : ''
  const skipped = counts.skipped ? ` ${t('imports.skipped', { count: counts.skipped })}` : ''
  const left = source === 'brainbro' ? ` ${t('imports.notInExports')}` : ''
  return created + existing + skipped + left
}
