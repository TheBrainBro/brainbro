import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router'

import { useLogout, useSession } from '../auth/session'
import { useInvitationCheck, useJoin } from '../invitations/api'
import { rich, useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'

/**
 * Where an invitation link opens: the invited person picks a username and
 * password, and lands in their new, empty BrainBro.
 */
export function JoinPage() {
  const t = useT()
  const { token = '' } = useParams()
  const { data: session } = useSession()
  const check = useInvitationCheck(token)
  const join = useJoin(token)
  const logout = useLogout()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // What is typed, over the address the invitation was emailed to.
  const [typedEmail, setEmail] = useState<string | null>(null)
  const email = typedEmail ?? check.data?.email ?? ''

  if (join.isSuccess) return <Navigate to="/" replace />

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <Logo className="size-10" />
        {check.isPending || !session ? (
          <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label={t('common.loading')} />
        ) : check.isError ? (
          <>
            <h1 className="text-xl font-semibold">{t('auth.invitationUnusable')}</h1>
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {check.error.message}
            </p>
            <p className="text-sm text-zinc-500">{t('auth.askForNewLink')}</p>
          </>
        ) : session.authenticated ? (
          <>
            <h1 className="text-xl font-semibold">{t('auth.alreadySignedIn')}</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {rich('auth.signedInAs', {
                username: session.user?.username ?? '',
                b: (chunk) => <strong className="font-medium">{chunk}</strong>,
              })}
            </p>
            <button
              type="button"
              className="button-primary w-full"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {t('auth.signOut')}
            </button>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              join.mutate({ username, password, ...(email.trim() ? { email: email.trim() } : {}) })
            }}
          >
            <div>
              <h1 className="text-xl font-semibold">{t('auth.join')}</h1>
              <p className="text-sm text-zinc-500">
                {t('auth.invited')}
              </p>
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium">{t('auth.username')}</span>
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
                <span className="text-sm font-medium">{t('auth.password')}</span>
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
                {t('auth.passwordHint')}
              </p>
            </div>

            {session.email_enabled && (
              <div className="space-y-1">
                <label className="block space-y-1">
                  <span className="text-sm font-medium">{t('auth.emailOptional')}</span>
                  <input
                    className="input"
                    type="email"
                    autoComplete="email"
                    aria-describedby="email-hint"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <p id="email-hint" className="text-xs text-zinc-500">
                  {t('auth.emailHint')}
                </p>
              </div>
            )}

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
              {join.isPending ? t('auth.makingAccount') : t('auth.makeAccount')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
