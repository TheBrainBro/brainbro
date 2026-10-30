import { LoaderCircle, Send, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { useConnectTelegram, useDisconnectTelegram, useTelegramStatus } from './api'

/** Connects a Telegram chat: what's sent or forwarded to the bot lands in the inbox. */
export function TelegramDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  const connect = useConnectTelegram()
  const disconnect = useDisconnectTelegram()
  const { data: status, isPending: loading } = useTelegramStatus(connect.isSuccess)

  return (
    <>
      <div className="backdrop" onMouseDown={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="telegram-title"
          className="popover pointer-events-auto w-full max-w-md p-5"
          // Keys stop here: the page's own shortcuts don't see them.
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') onClose()
          }}
        >
          <div className="mb-3 flex items-center gap-2">
            <Send className="size-5 text-accent-500" aria-hidden="true" />
            <h2 id="telegram-title" className="mr-auto font-semibold">
              Telegram
            </h2>
            <button
              ref={close}
              type="button"
              aria-label="Close"
              className="button-icon size-8"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
            Send or forward anything to the bot and it lands in your inbox: text, links, photos and
            files. Photos sent together become an album. The bot reacts with 👍 when it's saved.
          </p>

          {loading || !status ? null : !status.configured ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              The bot isn't set up on this server yet: it needs <code>TELEGRAM_BOT_TOKEN</code> and{' '}
              <code>TELEGRAM_BOT_USERNAME</code>.
            </p>
          ) : status.linked ? (
            <div className="space-y-3">
              <p role="status" className="text-sm">
                Connected{status.telegram_name && ` as ${status.telegram_name}`} to @
                {status.bot_username}.
              </p>
              {disconnect.isError && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {disconnect.error.message}
                </p>
              )}
              <button
                type="button"
                className="button-secondary"
                disabled={disconnect.isPending}
                onClick={() => {
                  connect.reset()
                  disconnect.mutate()
                }}
              >
                Disconnect
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
                Open @{status.bot_username} in Telegram
              </a>
              <p role="status" className="flex items-center gap-2 text-sm text-zinc-500">
                <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                Press Start there. The link works for an hour.
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
                Connect Telegram
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
