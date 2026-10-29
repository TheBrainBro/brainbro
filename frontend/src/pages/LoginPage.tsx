import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useLogin, useSession } from '../auth/session'
import { Logo } from '../layout/Logo'

export function LoginPage() {
  const { data: session } = useSession()
  const login = useLogin()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (session?.authenticated) return <Navigate to={from} replace />

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        onSubmit={(event) => {
          event.preventDefault()
          login.mutate({ username, password })
        }}
      >
        <div>
          <Logo className="mb-4 size-10" />
          <h1 className="text-xl font-semibold">Brain</h1>
          <p className="text-sm text-zinc-500">Sign in to continue</p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Username</span>
          <input
            className="input"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {login.isError && (
          <p role="alert" className="text-sm text-red-600">
            {login.error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending || !username || !password}
          className="button-primary w-full"
        >
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
