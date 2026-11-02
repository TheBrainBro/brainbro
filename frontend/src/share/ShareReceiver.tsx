import { useEffect, useEffectEvent } from 'react'

import { useCapturePipeline } from '../capture/context'
import { whenReachable } from '../lib/network'
import { remainingShare, shareToCaptureInputs } from './inputs'
import { deleteShare, listShares, saveShare } from './queue'

const LOCK = 'brainbro-share-queue'

let draining: Promise<void> | null = null

/** One drain at a time, across tabs too, so a share is never sent twice at once. */
function exclusive(drain: () => Promise<void>) {
  draining ??= (navigator.locks ? navigator.locks.request(LOCK, drain) : drain()).finally(() => {
    draining = null
  })
  return draining
}

/**
 * Sends what was shared into the app (see `sw.ts`) through the capture
 * pipeline, like a paste. Runs when the app opens signed in and whenever the
 * network may be back; what can't be sent yet stays queued for next time.
 */
export function ShareReceiver() {
  const { capture } = useCapturePipeline()

  const drain = useEffectEvent(() =>
    exclusive(async () => {
      if (!navigator.onLine) return
      for (const share of await listShares()) {
        const found = shareToCaptureInputs(share)
        const results = found.inputs.length ? await capture(found, { retryLater: true }) : []
        const waiting = found.inputs.filter((_, index) => {
          const result = results[index]
          return 'error' in result && result.deferred
        })
        if (!waiting.length) {
          await deleteShare(share.id)
          continue
        }
        await saveShare(remainingShare(share, waiting))
        // Still offline or signed out: the rest would fail the same way.
        break
      }
    }),
  )

  useEffect(() => {
    // No IndexedDB (some private modes): nothing can have been queued either.
    const run = () => void drain().catch((error) => console.warn('Share queue unavailable', error))
    run()
    return whenReachable(run)
  }, [])

  return null
}
