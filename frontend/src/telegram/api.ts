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
