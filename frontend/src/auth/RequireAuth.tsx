import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useSession } from './session'

export function RequireAuth() {
  const { data, isPending, isError } = useSession()
  const location = useLocation()

  if (isPending) return <FullScreenMessage>Loading…</FullScreenMessage>
  if (isError) {
    return <FullScreenMessage>Could not reach the server.</FullScreenMessage>
  }
  if (!data.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      {children}
    </div>
  )
}
