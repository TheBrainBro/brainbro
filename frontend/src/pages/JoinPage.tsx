import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { useInvitationCheck, useJoin } from '../invitations/api'
import { Logo } from '../layout/Logo'

/**
 * Where an invitation link opens: the invited person picks a username and
 * password, and lands in their new, empty Brain.
 */
export function JoinPage() {
  const { token = '' } = useParams()
  const { data: session } = useSession()
  const check = useInvitationCheck(token)
  const join = useJoin(token)
  const logout = useLogout()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  if (join.isSuccess) return <Navigate to="/" replace />

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <Logo className="size-10" />
        {check.isPending || !session ? (
          <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label="Loading" />
        ) : check.isError ? (
          <>
            <h1 className="text-xl font-semibold">Can't use this invitation</h1>
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {check.error.message}
            </p>
            <p className="text-sm text-zinc-500">Ask whoever invited you for a new link.</p>
          </>
        ) : session.authenticated ? (
          <>
            <h1 className="text-xl font-semibold">You're signed in</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              You're signed in as <strong className="font-medium">{session.user?.username}</strong>.
              Sign out to make a new account with this invitation.
            </p>
            <button
              type="button"
              className="button-primary w-full"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              Sign out
            </button>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              join.mutate({ username, password })
            }}
          >
            <div>
              <h1 className="text-xl font-semibold">Join Brain</h1>
              <p className="text-sm text-zinc-500">
                You're invited. Pick a username and password to make your account.
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium">Username</span>
              <input
                className="input"
                autoComplete="username"
                autoFocus
                maxLength={150}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            <div className="space-y-1">
              <label className="block space-y-1">
                <span className="text-sm font-medium">Password</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="password-hint"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p id="password-hint" className="text-xs text-zinc-500">
                At least 8 characters.
              </p>
            </div>

            {join.isError && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {join.error.message}
              </p>
            )}

            <button
              type="submit"
              disabled={join.isPending || !username.trim() || !password}
              className="button-primary flex w-full items-center justify-center gap-2"
            >
              {join.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {join.isPending ? 'Making your account…' : 'Make my account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
