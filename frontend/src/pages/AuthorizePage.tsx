import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useLocation } from 'react-router'

import { Logo } from '../layout/Logo'
import { useAnswerAuthorization, useAuthorizationAsk } from '../tokens/api'

/**
 * "Sign in to Brain" for AI assistants (OAuth): an app like ChatGPT opens
 * this page and the user allows it to use their Brain, or cancels. Either
 * way the browser goes back to the app.
 */
export function AuthorizePage() {
  const query = useLocation().search.replace(/^\?/, '')
  const ask = useAuthorizationAsk(query)
  const answer = useAnswerAuthorization(query)
  // Sent back: the page stays as it is while the browser leaves.
  const busy = answer.isPending || answer.isSuccess

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <Logo className="size-10" />
        {ask.isPending ? (
          <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label="Loading" />
        ) : ask.isError ? (
          <>
            <h1 className="text-xl font-semibold">Can't connect this app</h1>
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {ask.error.message}
            </p>
            <p className="text-sm text-zinc-500">Go back to the app and try connecting again.</p>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold">Connect {ask.data.client_name}?</h1>
              <p className="mt-1 text-sm text-zinc-500">
                It will go back to <strong className="font-medium">{ask.data.redirect_host}</strong>
              </p>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              It will be able to search and read everything in your Brain, capture notes and
              links, edit notes, organize items into collections and archive them. It can't
              delete anything.
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Only allow it if you started this from {ask.data.client_name}. You can disconnect
              it any time in Settings → AI assistants.
            </p>
            {answer.isError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {answer.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="button-secondary"
                disabled={busy}
                onClick={() => answer.mutate(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button-primary flex items-center gap-2"
                disabled={busy}
                onClick={() => answer.mutate(true)}
              >
                {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                Allow
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
