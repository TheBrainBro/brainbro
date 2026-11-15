import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { usePasswordResetCheck, useResetPassword } from '../auth/session'
import { rich, useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'

/** Where the link from a password reset email opens: a new password, then the app. */
export function ResetPasswordPage() {
  const t = useT()
  const { uid = '', token = '' } = useParams()
  const check = usePasswordResetCheck(uid, token)
  const reset = useResetPassword(uid, token)
  const [password, setPassword] = useState('')

  if (reset.isSuccess) return <Navigate to="/" replace />

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <Logo className="size-10" />
        {check.isPending ? (
          <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label={t('common.loading')} />
        ) : check.isError ? (
          <>
            <h1 className="text-xl font-semibold">{t('auth.resetLinkUnusable')}</h1>
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {check.error.message}
            </p>
            <p className="text-sm text-zinc-500">{t('auth.askForNewResetLink')}</p>
            <Link to="/login" className="block text-sm text-accent-600 hover:underline dark:text-accent-400">
              {t('auth.backToSignIn')}
            </Link>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              reset.mutate(password)
            }}
          >
            <div>
              <h1 className="text-xl font-semibold">{t('auth.newPasswordTitle')}</h1>
              <p className="text-sm text-zinc-500">
                {rich('auth.newPasswordFor', {
                  username: check.data.username,
                  b: (chunk) => <strong className="font-medium">{chunk}</strong>,
                })}
              </p>
            </div>

            {/* Lets the browser's password manager save it under the right account. */}
            <input type="hidden" autoComplete="username" value={check.data.username} readOnly />

            <div className="space-y-1">
              <label className="block space-y-1">
                <span className="text-sm font-medium">{t('auth.newPassword')}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  aria-describedby="password-hint"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p id="password-hint" className="text-xs text-zinc-500">
                {t('auth.passwordHint')}
              </p>
            </div>

            {reset.isError && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {reset.error.message}
              </p>
            )}

            <button
              type="submit"
              disabled={reset.isPending || !password}
              className="button-primary flex w-full items-center justify-center gap-2"
            >
              {reset.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {reset.isPending ? t('auth.savingPassword') : t('auth.savePassword')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
