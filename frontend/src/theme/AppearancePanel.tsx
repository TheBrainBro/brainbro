import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'

import { useT, type MessageKey } from '../i18n/i18n'
import { useSetTheme, useTheme, type Theme } from './theme'

const OPTIONS: { theme: Theme; label: MessageKey; icon: LucideIcon }[] = [
  { theme: 'light', label: 'appearance.light', icon: Sun },
  { theme: 'dark', label: 'appearance.dark', icon: Moon },
  { theme: 'system', label: 'appearance.system', icon: Monitor },
]

/** Light, dark or the device's own setting, the same on every device. */
export function AppearancePanel() {
  const t = useT()
  const theme = useTheme()
  const setTheme = useSetTheme()

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        {t('appearance.systemHint')}
      </p>
      <div role="radiogroup" aria-label={t('appearance.theme')} className="grid grid-cols-3 gap-2 sm:max-w-sm">
        {OPTIONS.map(({ theme: value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 p-3 text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 aria-checked:border-accent-500 aria-checked:text-accent-600 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100 dark:aria-checked:border-accent-400 dark:aria-checked:text-accent-300"
            onClick={() => setTheme.mutate(value)}
          >
            <Icon className="size-5" aria-hidden="true" />
            {t(label)}
          </button>
        ))}
      </div>
      {setTheme.isError && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {t('appearance.saveFailed')}
        </p>
      )}
    </div>
  )
}
