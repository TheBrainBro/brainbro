/**
 * Call `retry` when the network may be back: the `online` event, or the app
 * returning to the foreground (`online` doesn't fire on every network
 * change, such as a flaky connection that never reported going down).
 * Returns the cleanup.
 */
export function whenReachable(retry: () => void) {
  const onVisible = () => {
    if (document.visibilityState === 'visible') retry()
  }
  window.addEventListener('online', retry)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.removeEventListener('online', retry)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
