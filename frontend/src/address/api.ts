import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionKey } from '../auth/session'
import { api } from '../lib/api'

/** Where people outside reach the server; empty: the address each request comes in on. */
export type PublicAddress = { public_url: string }

const addressKey = ['server-address'] as const

export function usePublicAddress() {
  return useQuery({ queryKey: addressKey, queryFn: () => api<PublicAddress>('/server/address/') })
}

/** Every address the app shows changes with it, so the session is read again. */
export function useSavePublicAddress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PublicAddress) =>
      api<PublicAddress>('/server/address/', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: (address) => {
      queryClient.setQueryData(addressKey, address)
      void queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
}
