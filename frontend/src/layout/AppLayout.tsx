import { NavLink, Outlet } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { CaptureProvider } from '../capture/CaptureProvider'

const navigation = [
  { to: '/', label: 'Inbox', end: true },
  { to: '/boards', label: 'Boards' },
  { to: '/collections', label: 'Collections' },
]

/** The sidebar from `md` up; on phones a top bar and a tab bar with capture in the middle. */
export function AppLayout() {
  const { data: session } = useSession()
  const logout = useLogout()
  const signOut = (
    <button
      type="button"
      className="hover:text-zinc-900 dark:hover:text-zinc-100"
      onClick={() => logout.mutate()}
    >
      Sign out
    </button>
  )

  return (
    <CaptureProvider>
      <div className="flex h-full flex-col md:flex-row">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-3 md:flex dark:border-zinc-800 dark:bg-zinc-900">
          <div className="px-2 py-3 text-lg font-semibold">Brain</div>
          <nav className="flex flex-1 flex-col gap-1">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-2 py-1.5 text-sm ${
                    isActive
                      ? 'bg-zinc-100 font-medium dark:bg-zinc-800'
                      : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center justify-between px-2 py-2 text-sm text-zinc-500">
            <span>{session?.user?.username}</span>
            {signOut}
          </div>
        </aside>

        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
          <span className="font-semibold">Brain</span>
          <span className="text-sm text-zinc-500">{signOut}</span>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>

        <nav
          aria-label="Sections"
          className="grid grid-cols-4 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden dark:border-zinc-800 dark:bg-zinc-900"
        >
          <TabLink {...navigation[0]} />
          <TabLink {...navigation[1]} />
          <NavLink
            to="/capture"
            aria-label="Capture"
            className="flex items-center justify-center py-2"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-zinc-900 text-xl leading-none text-white dark:bg-zinc-100 dark:text-zinc-900">
              +
            </span>
          </NavLink>
          <TabLink {...navigation[2]} />
        </nav>
      </div>
    </CaptureProvider>
  )
}

function TabLink({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center justify-center py-3 text-xs ${
          isActive ? 'font-semibold' : 'text-zinc-500 dark:text-zinc-400'
        }`
      }
    >
      {label}
    </NavLink>
  )
}
