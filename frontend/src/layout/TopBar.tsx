import { Inbox, Keyboard, Library, LogOut, Search, Waypoints, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { combo } from '../lib/keys'
import { Logo } from './Logo'

type Section = { to: string; label: string; icon: LucideIcon; end?: boolean }

const sections: Section[] = [
  { to: '/', label: 'Inbox', icon: Inbox, end: true },
  { to: '/boards', label: 'Boards', icon: Waypoints },
  { to: '/collections', label: 'Collections', icon: Library },
]

/** Logo, the three sections as icons in the middle, search and the account menu. */
export function TopBar({
  onSearch,
  onShortcuts,
}: {
  onSearch: () => void
  onShortcuts: () => void
}) {
  return (
    <header className="relative z-30 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-zinc-200/80 bg-white/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-md sm:px-4 dark:border-zinc-800/80 dark:bg-zinc-950/80">
      <Link
        to="/"
        aria-label="Brain"
        className="flex items-center gap-2 justify-self-start rounded-lg p-1 font-semibold tracking-tight"
      >
        <Logo />
        <span className="hidden sm:inline">Brain</span>
      </Link>

      <nav
        aria-label="Sections"
        className="flex items-center gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
      >
        {sections.map((section) => (
          <SectionLink key={section.to} {...section} />
        ))}
      </nav>

      <div className="flex items-center gap-1 justify-self-end sm:gap-2">
        <button type="button" aria-label="Search" className="button-icon group" onClick={onSearch}>
          <Search className="size-5" strokeWidth={1.75} aria-hidden="true" />
          <span role="tooltip" className="tooltip top-full mt-2">
            Search {combo('K')}
          </span>
        </button>
        <AccountMenu onShortcuts={onShortcuts} />
      </div>
    </header>
  )
}

function SectionLink({ to, label, icon: Icon, end }: Section) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        `group relative flex h-9 w-12 items-center justify-center rounded-lg transition ${
          isActive
            ? 'bg-white text-accent-600 shadow-sm dark:bg-zinc-800 dark:text-accent-300'
            : 'text-zinc-500 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
        }`
      }
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      <span role="tooltip" className="tooltip top-full mt-2">
        {label}
      </span>
    </NavLink>
  )
}

function AccountMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const { data: session } = useSession()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)
  const username = session?.user?.username ?? ''

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!menu.current?.contains(event.target as Node)) setOpen(false)
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
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 text-sm font-semibold text-white uppercase shadow-sm ring-offset-2 ring-offset-white transition hover:ring-2 hover:ring-accent-300 dark:ring-offset-zinc-950 dark:hover:ring-accent-700"
        onClick={() => setOpen((value) => !value)}
      >
        {username.slice(0, 1) || '?'}
      </button>
      {open && (
        <div
          role="menu"
          className="popover absolute top-full right-0 mt-2 w-56 origin-top-right p-1"
        >
          <div className="px-3 py-2">
            <div className="text-xs text-zinc-500">Signed in as</div>
            <div className="truncate text-sm font-medium">{username}</div>
          </div>
          <div className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
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
            <span className="mr-auto">Keyboard shortcuts</span>
            <kbd className="kbd">?</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
