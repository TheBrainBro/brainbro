import { Bot, CircleAlert, CircleCheck, Globe, KeyRound, Link2, LoaderCircle, UserPlus } from 'lucide-react'
import { useId, useState } from 'react'

import { useT } from '../i18n/i18n'
import { type PublicAddress, usePublicAddress, useSavePublicAddress } from './api'

/**
 * Admins only: Settings, Server, General. For now, the address people
 * outside open BrainBro on: every link that leaves the server starts with
 * it, and BrainBro answers on it.
 */
export function AddressPanel() {
  const t = useT()
  const { data: address, isPending, error } = usePublicAddress()

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
    <div className="space-y-6">
      {/* A new form when the saved address changes, filled with it. */}
      <AddressForm key={address.public_url} address={address} />
    </div>
  )
}

function AddressForm({ address }: { address: PublicAddress }) {
  const t = useT()
  const save = useSavePublicAddress()
  const [value, setValue] = useState(address.public_url)
  const id = useId()
  const hintId = useId()
  const introId = useId()
  const changed = value.trim() !== address.public_url

  const usedBy = [
    { icon: UserPlus, label: t('address.usedByInvitations') },
    { icon: KeyRound, label: t('address.usedByPasswordResets') },
    { icon: Globe, label: t('address.usedByPublicNotes') },
    { icon: Bot, label: t('address.usedByAssistants') },
  ]

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ public_url: value.trim() })
      }}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor={id} className="block text-sm font-medium">
            {t('address.label')}
          </label>
          <p id={introId} className="text-sm text-zinc-600 dark:text-zinc-300">
            {t('address.intro')}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Link2
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <input
              id={id}
              className="input pl-9"
              inputMode="url"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="https://brainbro.example.com"
              aria-describedby={`${introId} ${hintId}`}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <button
            type="submit"
            className="button-primary inline-flex shrink-0 items-center gap-1.5"
            disabled={save.isPending || !changed}
          >
            {save.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {t('common.save')}
          </button>
        </div>
        {save.isError ? (
          <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {save.error.message}
          </p>
        ) : save.isSuccess ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
            {t('address.saved')}
          </p>
        ) : (
          <p id={hintId} className="text-xs text-zinc-500">
            {address.public_url ? t('address.hint') : t('address.hintEmpty', { origin: window.location.origin })}
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs text-zinc-500">{t('address.usedBy')}</p>
        <ul className="grid grid-cols-2 gap-2">
          {usedBy.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <Icon className="size-4 shrink-0 text-accent-500" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </form>
  )
}
