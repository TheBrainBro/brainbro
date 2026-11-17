import { LoaderCircle, Send } from 'lucide-react'

import { useT } from '../i18n/i18n'
import { useConnectTelegram, useDisconnectTelegram, useTelegramStatus } from './api'

/** Connects a Telegram chat: what's sent or forwarded to the bot lands in the inbox. */
export function TelegramPanel() {
  const t = useT()
  const connect = useConnectTelegram()
  const disconnect = useDisconnectTelegram()
  const { data: status, isPending: loading } = useTelegramStatus(connect.isSuccess)

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
        {t('telegram.intro')}
      </p>

      {loading || !status ? null : !status.configured ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          {t('telegram.notConfigured')}
        </p>
      ) : status.linked ? (
        <div className="space-y-3">
          <p role="status" className="text-sm">
            {status.telegram_name
              ? t('telegram.connectedAs', { name: status.telegram_name, bot: status.bot_username })
              : t('telegram.connected', { bot: status.bot_username })}
          </p>
          {disconnect.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {disconnect.error.message}
            </p>
          )}
          <button
            type="button"
            className="button-primary"
            disabled={disconnect.isPending}
            onClick={() => {
              connect.reset()
              disconnect.mutate()
            }}
          >
            {t('telegram.disconnect')}
          </button>
        </div>
      ) : connect.data ? (
        <div className="space-y-3">
          <a
            href={connect.data.url}
            target="_blank"
            rel="noreferrer"
            className="button-primary inline-flex items-center gap-1.5"
          >
            <Send className="size-4" aria-hidden="true" />
            {t('telegram.open', { bot: status.bot_username })}
          </a>
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-500">
            <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
            {t('telegram.pressStart')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {connect.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {connect.error.message}
            </p>
          )}
          <button
            type="button"
            className="button-primary"
            disabled={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {t('telegram.connect')}
          </button>
        </div>
      )}
    </div>
  )
}
