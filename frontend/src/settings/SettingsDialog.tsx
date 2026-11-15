import {
  Bot,
  FolderInput,
  Globe,
  HardDrive,
  Languages,
  PackageOpen,
  Palette,
  Send,
  Settings,
  UserPlus,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'

import { useSession } from '../auth/session'
import { BlogsPanel } from '../blogs/BlogsPanel'
import { SampleContentPanel } from './SampleContentPanel'
import { ExportPanel } from '../exports/ExportPanel'
import { useT, type MessageKey } from '../i18n/i18n'
import { ImportPanel } from '../imports/ImportPanel'
import { InvitationsPanel } from '../invitations/InvitationsPanel'
import { LanguagePanel } from './LanguagePanel'
import { TelegramPanel } from '../telegram/TelegramPanel'
import { AppearancePanel } from '../theme/AppearancePanel'
import { ProfilePanel } from './ProfilePanel'
import { StoragePanel } from '../storage/StoragePanel'
import { TokensPanel } from '../tokens/TokensPanel'

type Page = { id: string; label: MessageKey; icon: LucideIcon; Panel: ComponentType }

const groups: { label: MessageKey; pages: Page[] }[] = [
  {
    label: 'settings.groups.app',
    pages: [
      { id: 'profile', label: 'settings.pages.profile', icon: UserRound, Panel: ProfilePanel },
      { id: 'appearance', label: 'settings.pages.appearance', icon: Palette, Panel: AppearancePanel },
      { id: 'language', label: 'settings.pages.language', icon: Languages, Panel: LanguagePanel },
      { id: 'blogs', label: 'settings.pages.blogs', icon: Globe, Panel: BlogsPanel },
      { id: 'sample-content', label: 'settings.pages.sampleContent', icon: PackageOpen, Panel: SampleContentPanel },
    ],
  },
  {
    label: 'settings.groups.data',
    pages: [
      { id: 'import', label: 'settings.pages.import', icon: FolderInput, Panel: ImportPanel },
      { id: 'export', label: 'settings.pages.export', icon: PackageOpen, Panel: ExportPanel },
      { id: 'storage', label: 'settings.pages.storage', icon: HardDrive, Panel: StoragePanel },
    ],
  },
  {
    label: 'settings.groups.integrations',
    pages: [
      { id: 'telegram', label: 'settings.pages.telegram', icon: Send, Panel: TelegramPanel },
      { id: 'assistants', label: 'settings.pages.assistants', icon: Bot, Panel: TokensPanel },
    ],
  },
]

// Admins only: inviting people to the server.
const adminGroup = {
  label: 'settings.groups.server' as MessageKey,
  pages: [
    { id: 'invitations', label: 'settings.pages.invitations', icon: UserPlus, Panel: InvitationsPanel },
  ] as Page[],
}

/** Import, export, integrations and appearance: a list of pages on the side, the open one next to it. */
export function SettingsDialog({ page: initialPage, onClose }: { page?: string; onClose: () => void }) {
  const t = useT()
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  const { data: session } = useSession()
  const shown = useMemo(() => {
    const visibleGroups = groups
      .map((group) => ({
        ...group,
        pages: group.pages.filter(
          (page) => page.id !== 'sample-content' || session?.has_sample_content,
        ),
      }))
      .filter((group) => group.pages.length > 0)
    return session?.user?.is_staff ? [...visibleGroups, adminGroup] : visibleGroups
  }, [session?.has_sample_content, session?.user?.is_staff])
  const [openId, setOpenId] = useState(initialPage ?? groups[0].pages[0].id)
  const pages = useMemo(() => shown.flatMap((group) => group.pages), [shown])
  const page = pages.find((page) => page.id === openId) ?? pages[0]

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          className="popover pointer-events-auto flex h-[min(80vh,40rem)] w-full max-w-3xl flex-col"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
          }}
        >
          <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <Settings className="size-5 text-accent-500" aria-hidden="true" />
            <h2 id="settings-title" className="mr-auto font-semibold">
              {t('settings.title')}
            </h2>
            <button
              ref={close}
              type="button"
              aria-label={t('common.close')}
              className="button-icon size-8"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label={t('settings.title')}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 p-2 sm:w-52 sm:flex-col sm:border-r sm:border-b-0 dark:border-zinc-800"
            >
              {shown.map((group) => (
                <div key={group.label} className="flex shrink-0 gap-1 sm:flex-col">
                  <div className="hidden px-3 pt-2 pb-1 text-xs font-medium text-zinc-500 sm:block">
                    {t(group.label)}
                  </div>
                  {group.pages.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-current={id === page.id ? 'page' : undefined}
                      className="menu-item w-auto shrink-0 whitespace-nowrap sm:w-full aria-[current=page]:bg-zinc-100 aria-[current=page]:font-medium aria-[current=page]:text-zinc-900 dark:aria-[current=page]:bg-zinc-800 dark:aria-[current=page]:text-zinc-100"
                      onClick={() => setOpenId(id)}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {t(label)}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <section aria-labelledby="settings-page-title" className="min-w-0 flex-1 overflow-y-auto p-5">
              <h3 id="settings-page-title" className="mb-2 font-semibold">
                {t(page.label)}
              </h3>
              <page.Panel />
            </section>
          </div>
        </div>
      </div>
    </>
  )
}
