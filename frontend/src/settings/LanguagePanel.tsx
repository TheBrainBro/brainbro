import { Globe } from 'lucide-react'
import { useId } from 'react'

import { browserLanguage, LANGUAGE_NAMES, useLanguageChoice, useT, type LanguageChoice } from '../i18n/i18n'
import { useSetLanguage } from '../i18n/settings'

const CHOICES: LanguageChoice[] = ['system', ...(Object.keys(LANGUAGE_NAMES) as LanguageChoice[])]

/** The app's language, or the browser's, the same on every device. */
export function LanguagePanel() {
  const t = useT()
  const choice = useLanguageChoice()
  const setLanguage = useSetLanguage()
  const detectedId = useId()

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{t('language.systemHint')}</p>
      <div role="radiogroup" aria-label={t('language.label')} className="grid grid-cols-3 gap-2">
        {CHOICES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            aria-describedby={value === 'system' ? detectedId : undefined}
            className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 aria-checked:border-accent-500 aria-checked:text-accent-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100 dark:aria-checked:border-accent-400 dark:aria-checked:text-accent-300"
            onClick={() => setLanguage.mutate(value)}
          >
            {value === 'system' ? (
              <Globe className="size-5" aria-hidden="true" />
            ) : (
              <span className="flex h-5 items-center text-xs font-semibold tracking-wide uppercase" aria-hidden="true">
                {value}
              </span>
            )}
            <span>{value === 'system' ? t('language.system') : LANGUAGE_NAMES[value]}</span>
            {value === 'system' && (
              <span id={detectedId} aria-hidden="true" className="-mt-1 text-xs text-zinc-500">
                {t('language.detected', { language: LANGUAGE_NAMES[browserLanguage()] })}
              </span>
            )}
          </button>
        ))}
      </div>
      {setLanguage.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {t('language.saveFailed')}
        </p>
      )}
    </div>
  )
}
