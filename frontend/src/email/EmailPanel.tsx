import { CircleAlert, CircleCheck, LoaderCircle, Send } from 'lucide-react'
import { useId, useState } from 'react'

import { useSession } from '../auth/session'
import { useT } from '../i18n/i18n'
import {
  type EmailSettings,
  type EmailSettingsInput,
  useEmailSettings,
  useSaveEmailSettings,
  useSendTestEmail,
  useUseEnvironmentEmail,
} from './api'

/**
 * Admins only: who sends the server's email (password resets, invitations).
 * Saved here, it is used instead of the server's environment variables.
 */
export function EmailPanel() {
  const t = useT()
  const { data: settings, isPending, error } = useEmailSettings()

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
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('email.intro')}</p>
      <Status settings={settings} />
      {/* A new form when the saved settings change, filled with them. */}
      <EmailForm key={JSON.stringify(settings)} settings={settings} />
      <TestEmail enabled={settings.enabled} />
    </div>
  )
}

function Status({ settings }: { settings: EmailSettings }) {
  const t = useT()
  const backToEnvironment = useUseEnvironmentEmail()
  const status = !settings.enabled
    ? t('email.statusOff')
    : settings.source === 'database'
      ? t('email.statusSaved')
      : t('email.statusEnvironment')

  return (
    <div className="space-y-2">
      <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
        {settings.enabled ? (
          <CircleCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        ) : (
          <CircleAlert className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
        )}
        {status}
      </p>
      {settings.source === 'database' && (
        <div className="space-y-1">
          <button
            type="button"
            className="button-secondary"
            disabled={backToEnvironment.isPending}
            onClick={() => backToEnvironment.mutate()}
          >
            {t('email.useEnvironment')}
          </button>
          <p className="text-xs text-zinc-500">
            {settings.environment_enabled ? t('email.environmentOn') : t('email.environmentOff')}
          </p>
        </div>
      )}
    </div>
  )
}

function EmailForm({ settings }: { settings: EmailSettings }) {
  const t = useT()
  const save = useSaveEmailSettings()
  const [form, setForm] = useState<EmailSettingsInput>({
    provider: settings.provider,
    from_email: settings.from_email,
    mailgun_domain: settings.mailgun_domain,
    mailgun_region: settings.mailgun_region,
    mailgun_api_key: '',
  })
  const ids = { provider: useId(), key: useId(), domain: useId(), region: useId(), from: useId() }
  const set = (changes: Partial<EmailSettingsInput>) => setForm((current) => ({ ...current, ...changes }))

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate(form)
      }}
    >
      <div className="space-y-1">
        <label htmlFor={ids.provider} className="block text-sm font-medium">
          {t('email.provider')}
        </label>
        <select
          id={ids.provider}
          className="input"
          value={form.provider}
          onChange={(event) => set({ provider: event.target.value as EmailSettingsInput['provider'] })}
        >
          <option value="">{t('email.providerNone')}</option>
          <option value="mailgun">Mailgun</option>
        </select>
      </div>

      {form.provider === 'mailgun' && (
        <>
          <div className="space-y-1">
            <label htmlFor={ids.key} className="block text-sm font-medium">
              {t('email.apiKey')}
            </label>
            <input
              id={ids.key}
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={settings.has_api_key ? t('email.apiKeySaved') : ''}
              value={form.mailgun_api_key}
              onChange={(event) => set({ mailgun_api_key: event.target.value })}
            />
            <p className="text-xs text-zinc-500">{t('email.apiKeyHint')}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor={ids.domain} className="block text-sm font-medium">
              {t('email.domain')}
            </label>
            <input
              id={ids.domain}
              className="input"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="mail.example.com"
              value={form.mailgun_domain}
              onChange={(event) => set({ mailgun_domain: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor={ids.region} className="block text-sm font-medium">
              {t('email.region')}
            </label>
            <select
              id={ids.region}
              className="input"
              value={form.mailgun_region}
              onChange={(event) => set({ mailgun_region: event.target.value as EmailSettingsInput['mailgun_region'] })}
            >
              <option value="us">{t('email.regionUs')}</option>
              <option value="eu">{t('email.regionEu')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor={ids.from} className="block text-sm font-medium">
              {t('email.from')}
            </label>
            <input
              id={ids.from}
              className="input"
              placeholder={settings.default_from || 'BrainBro <noreply@mail.example.com>'}
              value={form.from_email}
              onChange={(event) => set({ from_email: event.target.value })}
            />
            <p className="text-xs text-zinc-500">{t('email.fromHint')}</p>
          </div>
        </>
      )}

      {save.isError && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {save.error.message}
        </p>
      )}

      <button type="submit" className="button-primary" disabled={save.isPending}>
        {t('common.save')}
      </button>
    </form>
  )
}

function TestEmail({ enabled }: { enabled: boolean }) {
  const t = useT()
  const { data: session } = useSession()
  const test = useSendTestEmail()
  const email = session?.user?.email ?? ''

  return (
    <section className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <button
        type="button"
        className="button-outline"
        disabled={!enabled || !email || test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Send className="size-4" aria-hidden="true" />
        )}
        {t('email.sendTest')}
      </button>
      <p className="text-xs text-zinc-500">
        {email ? t('email.testGoesTo', { email }) : t('email.testNeedsEmail')}
      </p>
      {test.isSuccess && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {t('email.testSent', { email: test.data.sent_to })}
        </p>
      )}
      {test.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {test.error.message}
        </p>
      )}
    </section>
  )
}
