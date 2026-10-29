import { Plus } from 'lucide-react'
import { Link, Outlet, useLocation } from 'react-router'

import { CaptureProvider } from '../capture/CaptureProvider'
import { ShareReceiver } from '../share/ShareReceiver'
import { ViewerProvider } from '../viewer/ViewerProvider'
import { TopBar } from './TopBar'

/** The top bar over the page; on phones, a capture button within thumb's reach. */
export function AppLayout() {
  const { pathname } = useLocation()
  // Where it would only get in the way: capturing already, or writing.
  const capturing = pathname === '/capture' || pathname.startsWith('/notes/')

  return (
    <CaptureProvider>
      <ViewerProvider>
        <ShareReceiver />
        <div className="flex h-full flex-col">
          <TopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            <Outlet />
          </main>
          {!capturing && (
            <Link
              to="/capture"
              aria-label="Capture"
              className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg shadow-accent-600/30 transition active:scale-95 md:hidden"
            >
              <Plus className="size-6" aria-hidden="true" />
            </Link>
          )}
        </div>
      </ViewerProvider>
    </CaptureProvider>
  )
}
