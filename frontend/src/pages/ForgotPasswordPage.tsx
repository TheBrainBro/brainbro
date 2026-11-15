import { CircleAlert, LoaderCircle, MailCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router'

import { useRequestPasswordReset, useSession } from '../auth/session'
import { rich, useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'

/** Asks for a link to choose a new password, sent to the account's email. */
export function ForgotPasswordPage() {
  const t = useT()
  const { data: session } = useSession()
  const request = useRequestPasswordReset()
  const [email, setEmail] = useState('')

  if (session?.authenticated) return <Navigate to="/" replace />

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <Logo className="size-10" />
        <h1 className="text-xl font-semibold">{t('auth.resetTitle')}</h1>
        {request.isSuccess ? (
          <p role="status" className="flex items-start gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-accent-500" aria-hidden="true" />
            <span>
              {rich('auth.linkSent', {
                email: email.trim(),
                b: (chunk) => <strong className="font-medium">{chunk}</strong>,
              })}
            </span>
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              request.mutate(email.trim())
            }}
          >
            <p className="text-sm text-zinc-500">{t('auth.resetIntro')}</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t('auth.email')}</span>
              <input
                className="input"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            {request.isError && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {request.error.message}
              </p>
            )}

            <button
              type="submit"
              disabled={request.isPending || !email.trim()}
              className="button-primary flex w-full items-center justify-center gap-2"
            >
              {request.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {request.isPending ? t('auth.sendingLink') : t('auth.sendLink')}
            </button>
          </form>
        )}
        <Link to="/login" className="block text-sm text-accent-600 hover:underline dark:text-accent-400">
          {t('auth.backToSignIn')}
        </Link>
      </div>
    </div>
  )
}
