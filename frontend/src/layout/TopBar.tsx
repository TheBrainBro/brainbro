import {
  Inbox,
  CircleHelp,
  Info,
  Keyboard,
  LayoutDashboard,
  Library,
  LogOut,
  Network,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { useT, type MessageKey } from '../i18n/i18n'
import { Avatar } from '../settings/Avatar'
import { combo } from '../lib/keys'
import { Logo, Wordmark } from './Logo'

type Section = { to: string; label: MessageKey; icon: LucideIcon; end?: boolean }

const sections: Section[] = [
  { to: '/', label: 'layout.inbox', icon: Inbox, end: true },
  { to: '/collections', label: 'layout.collections', icon: Library },
  { to: '/boards', label: 'layout.boards', icon: LayoutDashboard },
  { to: '/graph', label: 'layout.graph', icon: Network },
]

/** Logo, the sections as icons in the middle, search and the account menu. */
export function TopBar({
  onSearch,
  onShortcuts,
  onSettings,
  onWelcome,
  onAbout,
}: {
  onSearch: () => void
  onShortcuts: () => void
  onSettings: () => void
  onWelcome: () => void
  onAbout: () => void
}) {
  const t = useT()
  return (
    <header className="relative z-30 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-zinc-200/80 bg-white/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-4 dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <Link
        to="/"
        aria-label="BrainBro"
        className="flex items-center gap-2 justify-self-start rounded-lg p-1"
      >
        <Logo />
        <Wordmark className="hidden text-lg sm:inline" />
      </Link>

      <nav
        aria-label={t('layout.sections')}
        className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
      >
        {sections.map((section) => (
          <SectionLink key={section.to} {...section} />
        ))}
      </nav>

      <div className="flex items-center gap-1 justify-self-end sm:gap-2">
        <button type="button" aria-label={t('layout.search')} className="button-icon group/tip" onClick={onSearch}>
          <Search className="size-5" strokeWidth={1.75} aria-hidden="true" />
          <span role="tooltip" className="tooltip top-full mt-2">
            {t('layout.search')} {combo('K')}
          </span>
        </button>
        <AccountMenu
          onShortcuts={onShortcuts}
          onSettings={onSettings}
          onWelcome={onWelcome}
          onAbout={onAbout}
        />
      </div>
    </header>
  )
}

function SectionLink({ to, label, icon: Icon, end }: Section) {
  const t = useT()
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={t(label)}
      className={({ isActive }) =>
        `group/tip relative flex h-9 w-12 items-center justify-center rounded-lg transition ${
          isActive
            ? 'bg-white text-accent-600 shadow-sm dark:bg-zinc-800 dark:text-accent-300'
            : 'text-zinc-500 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
        }`
      }
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      <span role="tooltip" className="tooltip top-full mt-2">
        {t(label)}
      </span>
    </NavLink>
  )
}

function AccountMenu({
  onShortcuts,
  onSettings,
  onWelcome,
  onAbout,
}: {
  onShortcuts: () => void
  onSettings: () => void
  onWelcome: () => void
  onAbout: () => void
}) {
  const t = useT()
  const { data: session } = useSession()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const username = session?.user?.username ?? ''

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (menu.current?.contains(target as Node)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-label={t('layout.account')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full shadow-sm ring-offset-2 ring-offset-white transition hover:ring-2 hover:ring-accent-300 dark:ring-offset-zinc-950 dark:hover:ring-accent-700"
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar username={username} profile={session?.profile} />
      </button>
      {open && (
        <div
          role="menu"
          className="popover absolute top-full right-0 mt-2 w-56 origin-top-right p-1"
        >
          <div className="px-3 py-2">
            <div className="text-xs text-zinc-500">{t('layout.signedInAs')}</div>
            <div className="truncate text-sm font-medium">{username}</div>
          </div>
          <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false)
              onSettings()
            }}
          >
            <Settings className="size-4" aria-hidden="true" />
            {t('layout.settings')}
          </button>
          {/* Phones have no keyboard to speak of. */}
          <button
            type="button"
            role="menuitem"
            className="menu-item hidden md:flex"
            onClick={() => {
              setOpen(false)
              onShortcuts()
            }}
          >
            <Keyboard className="size-4" aria-hidden="true" />
            <span className="mr-auto">{t('layout.shortcuts')}</span>
            <kbd className="kbd">?</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false)
              onWelcome()
            }}
          >
            <Info className="size-4" aria-hidden="true" />
            {t('layout.welcomeTour')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false)
              onAbout()
            }}
          >
            <CircleHelp className="size-4" aria-hidden="true" />
            {t('layout.about')}
          </button>
          <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t('layout.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
