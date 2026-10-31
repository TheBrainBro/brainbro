import { Download, LoaderCircle } from 'lucide-react'

import { formatBytes } from '../lib/format'
import { useLatestExport, useStartExport } from './api'

/** Everything as a zip that works without Brain, built in the background. */
export function ExportPanel() {
  const { data: latest, isPending: loading } = useLatestExport()
  const start = useStartExport()
  const ready = latest?.status === 'ready' && latest.download_url ? latest : null

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        A zip with your notes and links as Markdown, your boards, and your images and files as
        you uploaded them, archived ones included. It works without Brain: a README inside
        explains the format.
      </p>

      {loading ? null : latest?.status === 'pending' ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-500" aria-hidden="true" />
          Preparing your export… You can close this, it keeps going.
        </p>
      ) : (
        <div className="space-y-3">
          {ready && (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mr-auto min-w-0 text-sm">
                <div className="truncate font-medium">{ready.filename}</div>
                <div className="text-xs text-zinc-500">
                  {ready.size !== null && `${formatBytes(ready.size)} · `}
                  {new Date(ready.created_at).toLocaleString()} · kept for a day
                </div>
              </div>
              <a
                href={ready.download_url ?? undefined}
                download
                className="button-primary flex shrink-0 items-center gap-1.5"
              >
                <Download className="size-4" aria-hidden="true" />
                Download
              </a>
            </div>
          )}
          {latest?.status === 'failed' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              The last export failed. Try again.
            </p>
          )}
          {start.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {start.error.message}
            </p>
          )}
          <button
            type="button"
            className={ready ? 'button-secondary' : 'button-primary'}
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {ready ? 'Make a new one' : 'Create export'}
          </button>
        </div>
      )}
    </div>
  )
}
