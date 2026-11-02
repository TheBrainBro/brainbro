import { LANGUAGE_NAMES, useLanguageChoice, useT, type LanguageChoice } from '../i18n/i18n'
import { useSetLanguage } from '../i18n/settings'

const CHOICES: LanguageChoice[] = ['system', ...(Object.keys(LANGUAGE_NAMES) as LanguageChoice[])]

/** The app's language, or the browser's, the same on every device. */
export function LanguagePanel() {
  const t = useT()
  const choice = useLanguageChoice()
  const setLanguage = useSetLanguage()

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{t('language.systemHint')}</p>
      <div role="radiogroup" aria-label={t('language.label')} className="grid gap-2 sm:max-w-sm">
        {CHOICES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 aria-checked:border-accent-500 aria-checked:text-accent-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100 dark:aria-checked:border-accent-400 dark:aria-checked:text-accent-300"
            onClick={() => setLanguage.mutate(value)}
          >
            {value === 'system' ? t('language.system') : LANGUAGE_NAMES[value]}
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
