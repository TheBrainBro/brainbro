import { LoaderCircle } from 'lucide-react'
import { useRef } from 'react'

import { useLatestImport, useStartImport } from './api'
import { summary } from './summary'

/** An Obsidian vault, uploaded as a zip and imported in the background. */
export function ImportPanel() {
  const input = useRef<HTMLInputElement>(null)
  const { data: latest, isPending: loading } = useLatestImport()
  const start = useStartImport()

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        Zip your vault folder and upload it. Folders become collections, notes keep the images
        they embed, other files become items and canvases become boards. What sits at the top of
        the vault lands in your inbox.
      </p>

      {loading ? null : start.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-accent-500"
            aria-hidden="true"
          />
          Uploading… {Math.round(start.progress * 100)}%
        </p>
      ) : latest?.status === 'pending' ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-accent-500"
            aria-hidden="true"
          />
          Importing {latest.filename}… You can close this, it keeps going.
        </p>
      ) : (
        <div className="space-y-3">
          {latest?.status === 'ready' && (
            <p role="status" className="text-sm">
              {summary(latest.counts)}
            </p>
          )}
          {latest?.status === 'failed' && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {latest.error || 'The last import failed.'}
            </p>
          )}
          {start.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {start.error.message}
            </p>
          )}
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="Vault zip"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) start.mutate(file)
            }}
          />
          <button
            type="button"
            className={latest?.status === 'ready' ? 'button-secondary' : 'button-primary'}
            onClick={() => input.current?.click()}
          >
            {latest?.status === 'ready' ? 'Import another vault' : 'Choose vault zip'}
          </button>
        </div>
      )}
    </div>
  )
}
