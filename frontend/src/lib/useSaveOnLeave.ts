import { useEffect } from 'react'

import type { SaveStatus } from './autosave'
import { whenReachable } from './network'

export type LeavableSaver = {
  status: SaveStatus
  flush: (options: { keepalive: boolean }) => unknown
  retryNow: () => void
  attach: () => void
  dispose: () => void
}

/**
 * Ties an autosave to the page: what is pending goes out with keepalive when
 * the page is hidden or closed, failed saves retry as soon as the network
 * may be back, closing the tab warns only when the save can't go out, and
 * unmounting saves what's left.
 */
export function useSaveOnLeave(saver: LeavableSaver) {
  useEffect(() => {
    saver.attach()
    const flushNow = () => saver.flush({ keepalive: true })
    const onVisibility = () => document.visibilityState === 'hidden' && flushNow()
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (['offline', 'error', 'conflict'].includes(saver.status)) event.preventDefault()
    }
    window.addEventListener('pagehide', flushNow)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    const stopRetrying = whenReachable(() => saver.retryNow())
    return () => {
      window.removeEventListener('pagehide', flushNow)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
      stopRetrying()
      saver.dispose()
    }
  }, [saver])
}
