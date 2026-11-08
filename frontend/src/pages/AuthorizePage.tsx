import { ArrowLeftRight, CircleAlert, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'

import { rich, useT } from '../i18n/i18n'
import { Logo } from '../layout/Logo'
import {
  DEFAULT_PERMISSIONS,
  useAnswerAuthorization,
  useAuthorizationAsk,
  type Permission,
} from '../tokens/api'
import { AppLogo } from '../tokens/AppLogo'
import { PermissionChoices } from '../tokens/PermissionChoices'

/**
 * "Sign in to BrainBro" for AI assistants (OAuth): an app like ChatGPT opens
 * this page and the user allows it to use their BrainBro, or cancels. Either
 * way the browser goes back to the app.
 */
export function AuthorizePage() {
  const t = useT()
  const query = useLocation().search.replace(/^\?/, '')
  const ask = useAuthorizationAsk(query)
  const answer = useAnswerAuthorization(query)
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_PERMISSIONS)
  // Sent back: the page stays as it is while the browser leaves.
  const busy = answer.isPending || answer.isSuccess

  return (
    <div className="flex h-full items-center justify-center bg-linear-to-b from-accent-50 to-zinc-50 p-4 dark:from-accent-950/40 dark:to-zinc-950">
      <div className="surface w-full max-w-sm space-y-4 rounded-2xl p-8 shadow-lg shadow-zinc-900/5 [animation:pop-in_200ms_ease-out]">
        <div className="flex items-center gap-3">
          <Logo className="size-10" />
          {ask.data && (
            <>
              <ArrowLeftRight className="size-4 text-zinc-400" aria-hidden="true" />
              <AppLogo logo={ask.data.logo} className="size-10 text-zinc-400" />
            </>
          )}
        </div>
        {ask.isPending ? (
          <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label={t('common.loading')} />
        ) : ask.isError ? (
          <>
            <h1 className="text-xl font-semibold">{t('auth.cantConnect')}</h1>
            <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {ask.error.message}
            </p>
            <p className="text-sm text-zinc-500">{t('auth.connectAgain')}</p>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold">{t('auth.connectApp', { app: ask.data.client_name })}</h1>
              <p className="mt-1 text-sm text-zinc-500">
                {rich('auth.goesBackTo', {
                  host: ask.data.redirect_host,
                  b: (chunk) => <strong className="font-medium">{chunk}</strong>,
                })}
              </p>
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {t('auth.appCan')}
            </p>
            <PermissionChoices value={permissions} onChange={setPermissions} disabled={busy} />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {t('auth.onlyAllow', { app: ask.data.client_name })}
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
                onClick={() => answer.mutate({ allow: false })}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="button-primary flex items-center gap-2"
                disabled={busy}
                onClick={() => answer.mutate({ allow: true, permissions })}
              >
                {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {t('auth.allow')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
