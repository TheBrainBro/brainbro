import { CloudOff } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { useT } from '../i18n/i18n'
import { useSessionLanguage } from '../i18n/settings'
import { whenReachable } from '../lib/network'
import { useSessionTheme } from '../theme/theme'
import { EmptyState, Loading } from '../ui/states'
import { useSession } from './session'

export function RequireAuth() {
  const { data, isPending, isError, fetchStatus, refetch } = useSession()
  const location = useLocation()
  useSessionTheme(data?.theme)
  useSessionLanguage(data?.language)
  const t = useT()

  // Opened offline (the service worker serves the app): try again when the
  // network is back or the app comes back to the foreground.
  useEffect(() => {
    if (!isError) return
    return whenReachable(() => void refetch())
  }, [isError, refetch])

  // Paused: TanStack Query knows it's offline and waits for the network.
  if (isError || (isPending && fetchStatus === 'paused')) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={CloudOff}
          title={navigator.onLine ? t('layout.unreachable') : t('layout.offline')}
        >
          {t('layout.offlineHint')}
        </EmptyState>
      </div>
    )
  }
  if (isPending) return <Loading />
  if (!data.authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}
