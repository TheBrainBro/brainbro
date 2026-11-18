import { Archive, Check, CircleAlert, Download, LoaderCircle } from 'lucide-react'

import { currentLanguage, useT, type MessageKey } from '../i18n/i18n'
import { formatBytes } from '../lib/format'
import { useLatestExport, useStartExport } from './api'

const INCLUDES: MessageKey[] = [
  'exports.includesNotes',
  'exports.includesBoards',
  'exports.includesFiles',
  'exports.includesArchived',
]

/** Everything as a zip that works without BrainBro, built in the background. */
export function ExportPanel() {
  const t = useT()
  const { data: latest, isPending: loading } = useLatestExport()
  const start = useStartExport()
  const ready = latest?.status === 'ready' && latest.download_url ? latest : null

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{t('exports.intro')}</p>

      <section aria-labelledby="export-title" className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 id="export-title" className="mb-3 flex items-center gap-2 font-medium">
          <Archive className="size-5 text-accent-500" aria-hidden="true" />
          {t('exports.title')}
        </h4>
        <ul className="mb-3 grid gap-x-4 gap-y-1.5 text-sm text-zinc-600 sm:grid-cols-2 dark:text-zinc-300">
          {INCLUDES.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="mb-4 text-xs text-zinc-500">{t('exports.readme')}</p>

        {loading ? null : latest?.status === 'pending' ? (
          <p role="status" className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-500" aria-hidden="true" />
            {t('exports.preparing')}
          </p>
        ) : (
          <div className="space-y-3">
            {ready && (
              <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                <div className="mr-auto min-w-0 text-sm">
                  <div className="truncate font-medium">{ready.filename}</div>
                  <div className="text-xs text-zinc-500">
                    {ready.size !== null && `${formatBytes(ready.size)} · `}
                    {new Date(ready.created_at).toLocaleString(currentLanguage())} ·{' '}
                    {t('exports.keptForADay')}
                  </div>
                </div>
                <a
                  href={ready.download_url ?? undefined}
                  download
                  className="button-primary flex shrink-0 items-center gap-1.5"
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t('exports.download')}
                </a>
              </div>
            )}
            {latest?.status === 'failed' && (
              <p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {t('exports.failed')}
              </p>
            )}
            {start.isError && (
              <p role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {start.error.message}
              </p>
            )}
            <button
              type="button"
              className={ready ? 'button-outline' : 'button-primary inline-flex items-center gap-2'}
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Archive className="size-4" aria-hidden="true" />
              )}
              {ready ? t('exports.again') : t('exports.create')}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
