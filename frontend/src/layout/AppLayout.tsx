import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { useMarkWelcomeSeen, useSession } from '../auth/session'
import { CaptureProvider } from '../capture/CaptureProvider'
import { isEditable } from '../lib/dom'
import { followChanges } from '../live/changes'
import { WelcomeDialog } from '../onboarding/WelcomeDialog'
import { SearchPalette } from '../search/SearchPalette'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ShareReceiver } from '../share/ShareReceiver'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { ShortcutsDialog } from '../ui/ShortcutsDialog'
import { ViewerProvider } from '../viewer/ViewerProvider'
import { TopBar } from './TopBar'

/** The top bar over the page; on phones, a capture button within thumb's reach. */
export function AppLayout() {
  const { pathname } = useLocation()
  // Where it would only get in the way: capturing already, or writing.
  const capturing = pathname === '/capture' || pathname.startsWith('/notes/')
  const [shortcuts, setShortcuts] = useState(false)
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  // The first visit opens on a short tour; the account menu brings it back.
  const { data: session } = useSession()
  const markWelcomeSeen = useMarkWelcomeSeen()
  const [welcome, setWelcome] = useState(() => session?.welcome_seen === false)
  const queryClient = useQueryClient()

  // What changes elsewhere (other devices, assistants) shows up here as it happens.
  useEffect(() => followChanges(queryClient), [queryClient])

  // `?` lists the shortcuts of the screen it's pressed on; Ctrl/Cmd+K
  // searches from anywhere, text fields included.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault()
        setSearching(true)
        return
      }
      if (event.key !== '?' || event.metaKey || event.ctrlKey || isEditable(event.target)) return
      event.preventDefault()
      setShortcuts(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <FeedbackProvider>
      <CaptureProvider>
        <ViewerProvider>
          <ShareReceiver />
          <div className="flex h-full flex-col">
            <TopBar
              onSearch={() => setSearching(true)}
              onShortcuts={() => setShortcuts(true)}
              onWelcome={() => setWelcome(true)}
              onSettings={() => setSettings(true)}
            />
            <main className="min-h-0 min-w-0 flex-1 overflow-auto">
              <Outlet />
            </main>
            {!capturing && (
              <Link
                to="/capture"
                aria-label="Capture"
                className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-accent-600 text-white shadow-lg shadow-accent-600/30 transition hover:bg-accent-500 active:scale-95 md:hidden"
              >
                <Plus className="size-6" aria-hidden="true" />
              </Link>
            )}
          </div>
          {searching && <SearchPalette onClose={() => setSearching(false)} />}
          {settings && <SettingsDialog onClose={() => setSettings(false)} />}
          {welcome && (
            <WelcomeDialog
              onClose={() => {
                if (!session?.welcome_seen) markWelcomeSeen.mutate()
                setWelcome(false)
              }}
            />
          )}
          {shortcuts && (
            <ShortcutsDialog pathname={pathname} onClose={() => setShortcuts(false)} />
          )}
        </ViewerProvider>
      </CaptureProvider>
    </FeedbackProvider>
  )
}
