import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useLogin, useSession } from '../auth/session'
import { useT } from '../i18n/i18n'
import { Logo, Wordmark } from '../layout/Logo'

export function LoginPage() {
  const t = useT()
  const { data: session } = useSession()
  const login = useLogin()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (session?.authenticated) return <Navigate to={from} replace />

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <form
        className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]"
        onSubmit={(event) => {
          event.preventDefault()
          login.mutate({ username, password })
        }}
      >
        <div>
          <Logo className="mb-4 size-10" />
          <h1 className="text-2xl">
            <Wordmark />
          </h1>
          <p className="text-sm text-zinc-500">{t('auth.tagline')}</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('auth.username')}</span>
          <input
            className="input"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('auth.password')}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {login.isError && (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {login.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending || !username || !password}
          className="button-primary flex w-full items-center justify-center gap-2"
        >
          {login.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
        </button>
      </form>
    </div>
  )
}
