import { t } from '../i18n/i18n'
import type { ImportCounts } from './api'

const NOUNS = ['notes', 'images', 'files', 'links', 'boards', 'collections'] as const

/** What an import created, as a sentence. */
export function summary(counts: Partial<ImportCounts>) {
  const parts = NOUNS.filter((key) => counts[key]).map((key) =>
    t(`counts.${key}`, { count: counts[key] ?? 0 }),
  )
  const created = parts.length
    ? t('imports.imported', { what: parts.join(', ') })
    : t('imports.nothing')
  const skipped = counts.skipped ? ` ${t('imports.skipped', { count: counts.skipped })}` : ''
  return created + skipped
}
