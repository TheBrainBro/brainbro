import { NavLink, Outlet } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { CaptureProvider } from '../capture/CaptureProvider'

const navigation = [
  { to: '/', label: 'Inbox', end: true },
  { to: '/boards', label: 'Boards' },
  { to: '/collections', label: 'Collections' },
]

export function AppLayout() {
  const { data: session } = useSession()
  const logout = useLogout()

  return (
    <CaptureProvider>
      <div className="flex h-full">
        <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
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
            <button
              type="button"
              className="hover:text-zinc-900 dark:hover:text-zinc-100"
              onClick={() => logout.mutate()}
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </CaptureProvider>
  )
}
