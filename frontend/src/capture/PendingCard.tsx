import { CircleAlert, RotateCw, X } from 'lucide-react'

import { useT } from '../i18n/i18n'
import { formatBytes } from '../lib/format'
import { useCapturePipeline, type PendingCapture } from './context'

/** An input on its way in, or one that failed, before it is a server item. */
export function PendingCard({ entry }: { entry: PendingCapture }) {
  const t = useT()
  const { retry, dismiss } = useCapturePipeline()
  const file = entry.input?.kind === 'file' ? entry.input.file : null
  const failed = entry.state === 'error'

  return (
    <article
      aria-busy={!failed}
      aria-label={t(failed ? 'pending.failed' : 'pending.capturing', { name: entry.label })}
      className={`flex gap-4 rounded-xl border bg-white p-4 shadow-xs dark:bg-zinc-900 ${
        failed
          ? 'border-red-300 dark:border-red-900'
          : 'border-dashed border-zinc-300 dark:border-zinc-700'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${failed ? '' : 'text-zinc-500'}`}>{entry.label}</p>
        {file && <p className="mt-0.5 text-xs text-zinc-500">{formatBytes(file.size)}</p>}

        {failed ? (
          <div className="mt-2 flex items-center gap-1 text-xs">
            <p role="alert" className="mr-auto flex items-center gap-1.5 text-red-600 dark:text-red-400">
              <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
              {entry.error}
            </p>
            {entry.retryable && (
              <button type="button" className="button-ghost" onClick={() => retry(entry.id)}>
                <RotateCw className="size-3.5" aria-hidden="true" />
                {t('pending.retry')}
              </button>
            )}
            <button type="button" className="button-ghost" onClick={() => dismiss(entry.id)}>
              <X className="size-3.5" aria-hidden="true" />
              {t('pending.dismiss')}
            </button>
          </div>
        ) : file ? (
          <div
            role="progressbar"
            aria-label={t('pending.uploading', { name: entry.label })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(entry.progress * 100)}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-accent-500 transition-[width]"
              style={{ width: `${Math.max(entry.progress, 0.02) * 100}%` }}
            />
          </div>
        ) : (
          <div className="skeleton mt-2 h-3 w-1/3" />
        )}
      </div>
      {entry.previewUrl && (
        <img
          src={entry.previewUrl}
          alt=""
          className="h-20 w-32 shrink-0 rounded-lg bg-zinc-100 object-cover opacity-70 dark:bg-zinc-800"
        />
      )}
    </article>
  )
}
