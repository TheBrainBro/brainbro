import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionKey } from '../auth/session'
import { api } from '../lib/api'

export type EmailProvider = '' | 'mailgun'
export type MailgunRegion = 'us' | 'eu'

/** How the server sends email. The API key never comes back: only whether there is one. */
export type EmailSettings = {
  /** `database`: saved in Settings; `environment`: the server's variables. */
  source: 'database' | 'environment'
  enabled: boolean
  provider: EmailProvider
  from_email: string
  /** The sender when `from_email` is empty. */
  default_from: string
  mailgun_domain: string
  mailgun_region: MailgunRegion
  has_api_key: boolean
  /** Whether the environment alone would send email. */
  environment_enabled: boolean
}

export type EmailSettingsInput = {
  provider: EmailProvider
  from_email: string
  mailgun_domain: string
  mailgun_region: MailgunRegion
  /** Empty keeps the key in use. */
  mailgun_api_key: string
}

const emailKey = ['server-email'] as const

export function useEmailSettings() {
  return useQuery({ queryKey: emailKey, queryFn: () => api<EmailSettings>('/server/email/') })
}

/** Whatever changes here turns email on or off for the whole app. */
function useEmailMutation<T>(run: (value: T) => Promise<EmailSettings>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: (settings) => {
      queryClient.setQueryData(emailKey, settings)
      void queryClient.invalidateQueries({ queryKey: sessionKey })
    },
  })
}

export function useSaveEmailSettings() {
  return useEmailMutation((input: EmailSettingsInput) =>
    api<EmailSettings>('/server/email/', { method: 'PUT', body: JSON.stringify(input) }),
  )
}

/** Drops the saved settings: the server's environment applies again. */
export function useUseEnvironmentEmail() {
  return useEmailMutation(() => api<EmailSettings>('/server/email/', { method: 'DELETE' }))
}

/** Sends a test email to the admin asking. */
export function useSendTestEmail() {
  return useMutation({
    mutationFn: () => api<{ sent_to: string; provider: string }>('/server/email/test/', { method: 'POST' }),
  })
}
