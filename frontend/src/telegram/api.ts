import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../lib/api'

export type TelegramStatus = {
  configured: boolean
  bot_username: string
  linked: boolean
  telegram_name: string
  linked_at: string | null
}

const statusKey = ['telegram'] as const
const POLL_MS = 2000

/** Whether the bot is set up and which chat is connected; polled while `waiting`. */
export function useTelegramStatus(waiting: boolean) {
  return useQuery({
    queryKey: statusKey,
    queryFn: () => api<TelegramStatus>('/telegram/'),
    refetchInterval: (query) => (waiting && !query.state.data?.linked ? POLL_MS : false),
  })
}

/** A one-time link that opens the bot and connects the chat. */
export function useConnectTelegram() {
  return useMutation({
    mutationFn: () => api<{ url: string }>('/telegram/connect/', { method: 'POST' }),
  })
}

export function useDisconnectTelegram() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/telegram/', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
  })
}

/** The bot this server speaks as (admins only). The token never comes back. */
export type TelegramSettings = {
  /** `database`: saved in Settings; `environment`: the server's variables. */
  source: 'database' | 'environment'
  configured: boolean
  bot_username: string
  /** Where Telegram delivers the bot's messages; empty without an HTTPS public address. */
  webhook_url: string
  /** Whether the environment alone sets up a bot. */
  environment_configured: boolean
}

const settingsKey = ['server-telegram'] as const

export function useTelegramSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: () => api<TelegramSettings>('/server/telegram/') })
}

/** Whatever changes here changes the bot everyone connects to. */
function useTelegramSettingsMutation<T>(run: (value: T) => Promise<TelegramSettings>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKey, settings)
      void queryClient.invalidateQueries({ queryKey: statusKey })
    },
  })
}

/** Checks the token with Telegram and saves it. */
export function useSaveTelegramSettings() {
  return useTelegramSettingsMutation((bot_token: string) =>
    api<TelegramSettings>('/server/telegram/', { method: 'PUT', body: JSON.stringify({ bot_token }) }),
  )
}

/** Disconnects the saved bot: the server's environment applies again. */
export function useRemoveTelegramSettings() {
  return useTelegramSettingsMutation(() => api<TelegramSettings>('/server/telegram/', { method: 'DELETE' }))
}
