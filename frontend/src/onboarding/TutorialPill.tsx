import { X } from 'lucide-react'

import { useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import { useFeedback } from '../ui/feedback'
import { useTutorial } from './tutorial'

/**
 * The tour, closed halfway: a pill in the corner to pick it up where it was
 * left, or to put it away for good.
 */
export function TutorialPill() {
  const t = useT()
  const tutorial = useTutorial()
  const { toast } = useFeedback()
  if (!tutorial.minimized) return null

  return (
    <div
      role="region"
      aria-label={t('tutorial.pill')}
      className="welcome-rise fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-40 flex items-center rounded-full border border-zinc-200 bg-white p-1 shadow-lg md:right-6 md:bottom-6 md:left-auto dark:border-zinc-700 dark:bg-zinc-900"
    >
      <button
        type="button"
        className="flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={tutorial.resume}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-950">
          <Logo className="size-6" />
        </span>
        <span>
          <span className="block text-sm font-medium">{t('tutorial.pill')}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {t('tutorial.pillProgress', { done: tutorial.progress.done, total: tutorial.progress.total })}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t('tutorial.hide')}
        className="button-icon group/tip relative mr-0.5 size-7"
        onClick={() => {
          tutorial.finish()
          toast({ message: t('tutorial.hidden') })
        }}
      >
        <X className="size-4" aria-hidden="true" />
        <span className="tooltip right-0 left-auto bottom-full mb-1.5 translate-x-0">{t('tutorial.hide')}</span>
      </button>
    </div>
  )
}
