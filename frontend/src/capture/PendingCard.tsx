import { formatBytes } from '../lib/format'
import { useCapturePipeline, type PendingCapture } from './context'

const actionButton =
  'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'

/** An input on its way in, or one that failed, before it is a server item. */
export function PendingCard({ entry }: { entry: PendingCapture }) {
  const { retry, dismiss } = useCapturePipeline()
  const file = entry.input?.kind === 'file' ? entry.input.file : null
  const failed = entry.state === 'error'

  return (
    <article
      aria-busy={!failed}
      aria-label={failed ? `Failed: ${entry.label}` : `Capturing ${entry.label}`}
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
            <p role="alert" className="mr-auto text-red-600">
              {entry.error}
            </p>
            {entry.retryable && (
              <button type="button" className={actionButton} onClick={() => retry(entry.id)}>
                Retry
              </button>
            )}
            <button type="button" className={actionButton} onClick={() => dismiss(entry.id)}>
              Dismiss
            </button>
          </div>
        ) : file ? (
          <div
            role="progressbar"
            aria-label={`Uploading ${entry.label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(entry.progress * 100)}
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-zinc-900 transition-[width] dark:bg-zinc-100"
              style={{ width: `${Math.max(entry.progress, 0.02) * 100}%` }}
            />
          </div>
        ) : (
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
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
