import { Keyboard, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useT } from '../i18n/i18n'
import { shortcutsFor } from './shortcuts'

/** Every shortcut of the current screen, opened with `?`. */
export function ShortcutsDialog({ pathname, onClose }: { pathname: string; onClose: () => void }) {
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
          aria-labelledby="shortcuts-title"
          className="popover pointer-events-auto max-h-[80vh] w-full max-w-md overflow-auto p-5"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape' || event.key === '?') onClose()
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <Keyboard className="size-5 text-accent-500" aria-hidden="true" />
            <h2 id="shortcuts-title" className="mr-auto font-semibold">
              {t('shortcuts.title')}
            </h2>
            <button ref={close} type="button" aria-label={t('common.close')} className="button-icon size-8" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {shortcutsFor(pathname).map((group) => (
            <section key={group.title} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                {group.title}
              </h3>
              <dl className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.label} className="flex items-center gap-3 text-sm">
                    <dt className="flex min-w-24 shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd key={key} className="kbd">
                          {key}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-zinc-600 dark:text-zinc-300">{shortcut.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
