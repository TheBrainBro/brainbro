import { ArrowRight, X } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType } from 'react'

import { useT, type MessageKey } from '../i18n/i18n'
import { Logo, Wordmark } from '../layout/Logo'
import { CaptureScene, SortScene, ViewsScene } from './scenes'

type Step = { Scene: ComponentType; title: MessageKey; line: MessageKey }

const steps: Step[] = [
  {
    Scene: CaptureScene,
    title: 'welcome.title',
    line: 'welcome.line',
  },
  { Scene: SortScene, title: 'welcome.sortTitle', line: 'welcome.sortLine' },
  { Scene: ViewsScene, title: 'welcome.viewsTitle', line: 'welcome.viewsLine' },
]

/** A short animated tour of what the app does, shown on the first visit. */
export function WelcomeDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [index, setIndex] = useState(0)
  // The dialog takes focus, not a button: the arrows work without a ring on Next.
  const dialog = useRef<HTMLDivElement>(null)
  useEffect(() => dialog.current?.focus(), [])
  const step = steps[index]
  const last = index === steps.length - 1

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          ref={dialog}
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby="welcome-title"
          className="popover pointer-events-auto w-full max-w-md p-4 outline-none"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
            if (event.key === 'ArrowRight' && !last) setIndex(index + 1)
            if (event.key === 'ArrowLeft' && index > 0) setIndex(index - 1)
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <Logo className="size-6" />
            <Wordmark className="mr-auto text-base" />
            <button type="button" aria-label={t('common.close')} className="button-icon size-8" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {/* Keyed: each step's animation starts from the top. */}
          <step.Scene key={index} />

          <div className="px-1 pt-4 pb-1">
            <h2 id="welcome-title" className="text-lg font-semibold">
              {t(step.title)}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{t(step.line)}</p>
          </div>

          <div className="mt-3 flex items-center gap-2 px-1">
            <div className="mr-auto flex gap-1.5">
              {steps.map((each, position) => (
                <button
                  key={each.title}
                  type="button"
                  aria-label={t('welcome.goTo', { step: position + 1 })}
                  aria-current={position === index ? 'step' : undefined}
                  className="size-2 rounded-full bg-zinc-300 transition-all aria-[current=step]:w-5 aria-[current=step]:bg-accent-500 dark:bg-zinc-700"
                  onClick={() => setIndex(position)}
                />
              ))}
            </div>
            {!last && (
              <button type="button" className="button-secondary" onClick={onClose}>
                {t('welcome.skip')}
              </button>
            )}
            <button
              type="button"
              className="button-primary inline-flex items-center gap-1.5"
              onClick={() => (last ? onClose() : setIndex(index + 1))}
            >
              {last ? t('welcome.start') : t('welcome.next')}
              {!last && <ArrowRight className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
