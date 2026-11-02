import { BookOpen, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useT } from '../i18n/i18n'
import { Logo, Wordmark } from './Logo'

const REPO = 'https://github.com/TheBrainBro/brainbro'
const DOCS = `${REPO}/tree/main/docs`

/** The logo, which version runs on which server, and where the docs and the code live. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
          className="popover pointer-events-auto relative w-full max-w-sm p-6 text-center"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
          }}
        >
          <button
            ref={close}
            type="button"
            aria-label={t('common.close')}
            className="button-icon absolute top-3 right-3 size-8"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </button>

          <Logo className="mx-auto size-16" />
          <h2 id="about-title" className="mt-3 text-2xl">
            <Wordmark />
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('about.tagline')}</p>

          <dl className="mt-5 divide-y divide-zinc-200 rounded-lg border border-zinc-200 text-left text-sm dark:divide-zinc-800 dark:border-zinc-800">
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-zinc-500">{t('about.version')}</dt>
              <dd className="font-medium tabular-nums">{__APP_VERSION__}</dd>
            </div>
            <div className="flex justify-between gap-4 px-3 py-2">
              <dt className="text-zinc-500">{t('about.server')}</dt>
              <dd className="truncate font-medium">{window.location.host}</dd>
            </div>
          </dl>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <a href={DOCS} target="_blank" rel="noreferrer" className="button-outline">
              <BookOpen className="size-4" aria-hidden="true" />
              {t('about.docs')}
            </a>
            <a href={REPO} target="_blank" rel="noreferrer" className="button-outline">
              <GitHubLogo />
              GitHub
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}
