import { FolderInput, PackageOpen, Send, Settings, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType } from 'react'

import { ExportPanel } from '../exports/ExportPanel'
import { ImportPanel } from '../imports/ImportPanel'
import { TelegramPanel } from '../telegram/TelegramPanel'

type Page = { id: string; label: string; icon: LucideIcon; Panel: ComponentType }

const groups: { label: string; pages: Page[] }[] = [
  {
    label: 'Data',
    pages: [
      { id: 'import', label: 'Import from Obsidian', icon: FolderInput, Panel: ImportPanel },
      { id: 'export', label: 'Export everything', icon: PackageOpen, Panel: ExportPanel },
    ],
  },
  {
    label: 'Integrations',
    pages: [{ id: 'telegram', label: 'Telegram', icon: Send, Panel: TelegramPanel }],
  },
]

/** Import, export and integrations: a list of pages on the side, the open one next to it. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  const [openId, setOpenId] = useState(groups[0].pages[0].id)
  const page = groups.flatMap((group) => group.pages).find((page) => page.id === openId)!

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          className="popover pointer-events-auto flex max-h-[80vh] w-full max-w-2xl flex-col"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
          }}
        >
          <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <Settings className="size-5 text-accent-500" aria-hidden="true" />
            <h2 id="settings-title" className="mr-auto font-semibold">
              Settings
            </h2>
            <button
              ref={close}
              type="button"
              aria-label="Close"
              className="button-icon size-8"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label="Settings"
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0 dark:border-zinc-800"
            >
              {groups.map((group) => (
                <div key={group.label} className="flex gap-1 sm:flex-col">
                  <div className="hidden px-3 pt-2 pb-1 text-xs font-medium text-zinc-500 sm:block">
                    {group.label}
                  </div>
                  {group.pages.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-current={id === openId ? 'page' : undefined}
                      className="menu-item shrink-0 whitespace-nowrap aria-[current=page]:bg-zinc-100 aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 dark:aria-[current=page]:bg-zinc-800 dark:aria-[current=page]:text-zinc-100"
                      onClick={() => setOpenId(id)}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <section aria-labelledby="settings-page-title" className="min-w-0 flex-1 overflow-y-auto p-5">
              <h3 id="settings-page-title" className="mb-2 font-semibold">
                {page.label}
              </h3>
              <page.Panel />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
