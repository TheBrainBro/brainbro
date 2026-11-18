import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { useT } from '../i18n/i18n'
import { useOpenSettingsPage } from './navigation'

/**
 * A warning about something set up elsewhere, with a button that opens the
 * settings page where it is fixed (when shown inside the settings dialog).
 */
export function Notice({ children, page }: { children: ReactNode; page?: string }) {
  const t = useT()
  const openPage = useOpenSettingsPage()

  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="mr-auto">{children}</p>
      {page && openPage && (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-0.5 font-medium underline-offset-2 hover:underline"
          onClick={() => openPage(page)}
        >
          {t('common.setUp')}
        </button>
      )}
    </div>
  )
}
