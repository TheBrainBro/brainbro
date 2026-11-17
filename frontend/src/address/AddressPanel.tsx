import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'

import { useT } from '../i18n/i18n'
import { type PublicAddress, usePublicAddress, useSavePublicAddress } from './api'

/**
 * Admins only: the address people outside open BrainBro on. Every link that
 * leaves the server starts with it, and BrainBro answers on it.
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
    <div className="space-y-6 sm:max-w-md">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('address.intro')}</p>
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

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ public_url: value.trim() })
      }}
    >
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {t('address.label')}
        </label>
        <input
          id={id}
          className="input"
          inputMode="url"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="https://brain.example.com"
          aria-describedby={hintId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p id={hintId} className="text-xs text-zinc-500">
          {address.public_url ? t('address.hint') : t('address.hintEmpty', { origin: window.location.origin })}
        </p>
      </div>
      {save.isError && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {save.error.message}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
          {t('address.saved')}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={save.isPending}>
        {t('common.save')}
      </button>
    </form>
  )
}
