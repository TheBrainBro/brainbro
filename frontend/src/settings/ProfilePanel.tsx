import { CircleCheck, ImagePlus, LoaderCircle } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useSaveDisplayName, useSaveEmail, useSaveHandle, useSession, useSetAvatar } from '../auth/session'
import { useT } from '../i18n/i18n'
import { appHost } from '../lib/address'
import { squareImage } from '../lib/image'
import { Avatar } from './Avatar'
import { SettingsSection } from './SettingsSection'

/** The display name that signs public notes, their address, and the photo the app shows. */
export function ProfilePanel() {
  const t = useT()
  const { data: session } = useSession()
  const profile = session?.profile ?? { display_name: '', avatar_url: null }
  const username = session?.user?.username ?? ''
  const saveName = useSaveDisplayName()
  const saveHandle = useSaveHandle()
  const saveEmail = useSaveEmail()
  const setAvatar = useSetAvatar()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const ids = { name: useId(), handle: useId(), email: useId() }

  const [name, setName] = useState(profile.display_name)
  // What is typed, over the saved one: the handle can arrive later (first publish).
  const [typedHandle, setHandle] = useState<string | null>(null)
  const handle = typedHandle ?? profile.handle ?? ''
  const savedEmail = session?.user?.email ?? ''
  const [typedEmail, setEmail] = useState<string | null>(null)
  const email = typedEmail ?? savedEmail
  const [error, setError] = useState<string>()
  const [photoError, setPhotoError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const nameChanged = name.trim() !== profile.display_name
  const handleChanged = !!handle.trim() && handle.trim() !== (profile.handle ?? '')
  const emailChanged = email.trim() !== savedEmail
  const changed = nameChanged || handleChanged || emailChanged

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setPhotoError(undefined)
    let square: Blob
    try {
      square = await squareImage(file)
    } catch {
      return setPhotoError(t('profile.notAnImage'))
    }
    setAvatar.mutate(square, { onError: (failure) => setPhotoError(failure.message) })
  }

  /** Saves only what changed, one field after the other: the first refusal stops it. */
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setSaved(false)
    setSaving(true)
    try {
      if (nameChanged) await saveName.mutateAsync(name.trim())
      if (handleChanged) {
        await saveHandle.mutateAsync(handle.trim())
        setHandle(null)
        // Every published note's address changes with it.
        void queryClient.invalidateQueries({ queryKey: ['items'] })
      }
      if (emailChanged) {
        await saveEmail.mutateAsync(email.trim())
        setEmail(null)
      }
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="divide-y divide-zinc-200 dark:divide-zinc-800" onSubmit={submit}>
      <div className="flex items-center gap-4 pb-6">
        <Avatar username={username} profile={profile} className="size-20 text-2xl" />
        <div className="min-w-0 space-y-2">
          <div>
            <p className="truncate font-medium">{profile.display_name || username}</p>
            {profile.handle && <p className="truncate text-sm text-zinc-500">@{profile.handle}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="button-outline px-3 py-1.5"
              disabled={setAvatar.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="size-4" aria-hidden="true" />
              {profile.avatar_url ? t('profile.changePhoto') : t('profile.uploadPhoto')}
            </button>
            {profile.avatar_url && (
              <button
                type="button"
                className="button-danger-ghost"
                disabled={setAvatar.isPending}
                onClick={() => setAvatar.mutate(null, { onError: (failure) => setPhotoError(failure.message) })}
              >
                {t('common.remove')}
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label={t('profile.photo')}
              className="hidden"
              onChange={(event) => {
                void pickPhoto(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          {photoError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {photoError}
            </p>
          )}
        </div>
      </div>

      <SettingsSection title={t('profile.publicProfile')} description={t('profile.publicProfileHint')}>
        <div className="space-y-1">
          <label htmlFor={ids.name} className="block text-sm font-medium">
            {t('profile.displayName')}
          </label>
          <input
            id={ids.name}
            className="input"
            value={name}
            maxLength={80}
            placeholder={t('profile.yourName')}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-xs text-zinc-500">{t('profile.displayNameHint')}</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.handle} className="block text-sm font-medium">
            {t('profile.handle')}
          </label>
          <div className="flex rounded-lg border border-zinc-300 bg-white transition focus-within:border-accent-400 focus-within:ring-3 focus-within:ring-accent-500/15 dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-accent-500">
            <span className="flex items-center border-r border-zinc-300 bg-zinc-50 px-3 text-sm whitespace-nowrap text-zinc-500 rounded-l-lg dark:border-zinc-700 dark:bg-zinc-900">
              {appHost(session)}/@
            </span>
            <input
              id={ids.handle}
              className="min-w-0 flex-1 rounded-r-lg bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              value={handle}
              maxLength={40}
              spellCheck={false}
              autoCapitalize="none"
              placeholder={t('profile.handlePlaceholder')}
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
            />
          </div>
          <p className="text-xs text-zinc-500">{t('profile.handleHint')}</p>
        </div>
      </SettingsSection>

      <SettingsSection title={t('profile.account')}>
        <div className="space-y-1">
          <label htmlFor={ids.email} className="block text-sm font-medium">
            {t('profile.email')}
          </label>
          <input
            id={ids.email}
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            placeholder={t('profile.emailPlaceholder')}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="text-xs text-zinc-500">
            {session?.email_enabled ? t('profile.emailHint') : t('profile.emailOff')}
          </p>
        </div>
      </SettingsSection>

      <div className="flex items-center justify-end gap-3 pt-6">
        {error ? (
          <p role="alert" className="mr-auto text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : (
          saved &&
          !changed && (
            <p role="status" className="mr-auto flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="size-4 shrink-0" aria-hidden="true" />
              {t('profile.saved')}
            </p>
          )
        )}
        <button type="submit" className="button-primary inline-flex items-center gap-1.5" disabled={!changed || saving}>
          {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {t('common.save')}
        </button>
      </div>
    </form>
  )
}
