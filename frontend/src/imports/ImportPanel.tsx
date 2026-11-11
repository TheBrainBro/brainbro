import { LoaderCircle } from 'lucide-react'
import { useRef, type ComponentType } from 'react'

import { t, useT } from '../i18n/i18n'
import { useLatestImport, useStartImport } from './api'
import { summary } from './summary'

type Source = { id: string; label: string; Logo: ComponentType; Import: ComponentType }

// The apps notes can come from, one card each.
const sources: Source[] = [
  { id: 'obsidian', label: 'Obsidian', Logo: ObsidianLogo, Import: ObsidianImport },
]

/** Brings notes in from other apps: one card per app, each with its own upload. */
export function ImportPanel() {
  useT()
  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        {t('imports.intro')}
      </p>
      <ul className="space-y-3">
        {sources.map(({ id, label, Logo, Import }) => (
          <li
            key={id}
            aria-labelledby={`import-${id}`}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h4 id={`import-${id}`} className="mb-2 flex items-center gap-2 font-medium">
              <Logo />
              {label}
            </h4>
            <Import />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Obsidian's mark, from Simple Icons (CC0, see THIRD_PARTY_NOTICES.md), in its brand purple. */
function ObsidianLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-[#7c3aed]" aria-hidden="true">
      <path d="M19.355 18.538a68.967 68.959 0 0 0 1.858-2.954.81.81 0 0 0-.062-.9c-.516-.685-1.504-2.075-2.042-3.362-.553-1.321-.636-3.375-.64-4.377a1.707 1.707 0 0 0-.358-1.05l-3.198-4.064a3.744 3.744 0 0 1-.076.543c-.106.503-.307 1.004-.536 1.5-.134.29-.29.6-.446.914l-.31.626c-.516 1.068-.997 2.227-1.132 3.59-.124 1.26.046 2.73.815 4.481.128.011.257.025.386.044a6.363 6.363 0 0 1 3.326 1.505c.916.79 1.744 1.922 2.415 3.5zM8.199 22.569c.073.012.146.02.22.02.78.024 2.095.092 3.16.29.87.16 2.593.64 4.01 1.055 1.083.316 2.198-.548 2.355-1.664.114-.814.33-1.735.725-2.58l-.01.005c-.67-1.87-1.522-3.078-2.416-3.849a5.295 5.295 0 0 0-2.778-1.257c-1.54-.216-2.952.19-3.84.45.532 2.218.368 4.829-1.425 7.531zM5.533 9.938c-.023.1-.056.197-.098.29L2.82 16.059a1.602 1.602 0 0 0 .313 1.772l4.116 4.24c2.103-3.101 1.796-6.02.836-8.3-.728-1.73-1.832-3.081-2.55-3.831zM9.32 14.01c.615-.183 1.606-.465 2.745-.534-.683-1.725-.848-3.233-.716-4.577.154-1.552.7-2.847 1.235-3.95.113-.235.223-.454.328-.664.149-.297.288-.577.419-.86.217-.47.379-.885.46-1.27.08-.38.08-.72-.014-1.043-.095-.325-.297-.675-.68-1.06a1.6 1.6 0 0 0-1.475.36l-4.95 4.452a1.602 1.602 0 0 0-.513.952l-.427 2.83c.672.59 2.328 2.316 3.335 4.711.09.21.175.43.253.653z" />
    </svg>
  )
}

/** An Obsidian vault, uploaded as a zip and imported in the background. */
function ObsidianImport() {
  useT()
  const input = useRef<HTMLInputElement>(null)
  const { data: latest, isPending: loading } = useLatestImport()
  const start = useStartImport()

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        {t('imports.obsidianIntro')}
      </p>

      {loading ? null : start.isPending ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-accent-500"
            aria-hidden="true"
          />
          {t('imports.uploading', { percent: Math.round(start.progress * 100) })}
        </p>
      ) : latest?.status === 'pending' ? (
        <p role="status" className="flex items-center gap-2 text-sm">
          <LoaderCircle
            className="size-4 shrink-0 animate-spin text-accent-500"
            aria-hidden="true"
          />
          {t('imports.importing', { filename: latest.filename })}
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
              {latest.error || t('imports.failed')}
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
            aria-label={t('imports.vaultZip')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) start.mutate(file)
            }}
          />
          <button
            type="button"
            className="button-primary"
            onClick={() => input.current?.click()}
          >
            {latest?.status === 'ready' ? t('imports.another') : t('imports.choose')}
          </button>
        </div>
      )}
    </div>
  )
}
