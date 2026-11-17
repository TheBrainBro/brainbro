import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'

import { useT } from '../i18n/i18n'
import {
  type TelegramSettings,
  useRemoveTelegramSettings,
  useSaveTelegramSettings,
  useTelegramSettings,
} from './api'

/**
 * Admins only: Settings, Server, Telegram. The bot people connect to in
 * Settings, Telegram. Saved here, it is used instead of the server's
 * environment variables.
 */
export function TelegramServerPanel() {
  const t = useT()
  const { data: settings, isPending, error } = useTelegramSettings()

  if (isPending) {
    return <LoaderCircle className="size-5 animate-spin text-accent-500" aria-label={t('common.loading')} />
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {error.message}
      </p>
    )
  }
  return (
    <div className="space-y-6 sm:max-w-md">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('telegramServer.intro')}</p>
      <Status settings={settings} />
      {/* A new form when the saved bot changes. */}
      <TokenForm key={`${settings.source}:${settings.bot_username}`} settings={settings} />
    </div>
  )
}

function Status({ settings }: { settings: TelegramSettings }) {
  const t = useT()
  const remove = useRemoveTelegramSettings()
  const status = !settings.configured
    ? t('telegramServer.statusOff')
    : settings.source === 'database'
      ? t('telegramServer.statusSaved', { bot: settings.bot_username })
      : t('telegramServer.statusEnvironment', { bot: settings.bot_username })

  return (
    <div className="space-y-2">
      <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
        {settings.configured ? (
          <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        ) : (
          <CircleAlert className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
        )}
        {status}
      </p>
      {settings.configured &&
        (settings.webhook_url ? (
          <p className="text-xs break-all text-zinc-500">
            {t('telegramServer.webhook', { url: settings.webhook_url })}
          </p>
        ) : (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('telegramServer.noWebhook')}
          </p>
        ))}
      {settings.source === 'database' && (
        <div className="space-y-1">
          <button
            type="button"
            className="button-secondary"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('telegramServer.remove')}
          </button>
          <p className="text-xs text-zinc-500">
            {settings.environment_configured
              ? t('telegramServer.environmentOn')
              : t('telegramServer.environmentOff')}
          </p>
          {remove.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {remove.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function TokenForm({ settings }: { settings: TelegramSettings }) {
  const t = useT()
  const save = useSaveTelegramSettings()
  const [token, setToken] = useState('')
  const id = useId()
  const hintId = useId()

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(token.trim())
      }}
    >
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {t('telegramServer.token')}
        </label>
        <input
          id={id}
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={settings.source === 'database' ? t('telegramServer.tokenSaved') : '123456789:AA...'}
          aria-describedby={hintId}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <p id={hintId} className="text-xs text-zinc-500">
          {t('telegramServer.tokenHint')}
        </p>
      </div>
      {save.isError && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {save.error.message}
        </p>
      )}
      <button
        type="submit"
        className="button-primary inline-flex items-center gap-1.5"
        disabled={save.isPending || !token.trim()}>
        {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
        {t('common.save')}
      </button>
    </form>
  )
}
