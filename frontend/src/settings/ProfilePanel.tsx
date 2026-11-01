import { ImagePlus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { useSaveDisplayName, useSession, useSetAvatar } from '../auth/session'
import { squareImage } from '../lib/image'
import { Avatar } from './Avatar'

/** The display name that signs public notes, and the photo the app shows. */
export function ProfilePanel() {
  const { data: session } = useSession()
  const profile = session?.profile ?? { display_name: '', avatar_url: null }
  const saveName = useSaveDisplayName()
  const setAvatar = useSetAvatar()
  const [name, setName] = useState(profile.display_name)
  const [error, setError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const nameId = useId()

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    setError(undefined)
    let square: Blob
    try {
      square = await squareImage(file)
    } catch {
      return setError("That file isn't an image this browser can read.")
    }
    setAvatar.mutate(square, { onError: (failure) => setError(failure.message) })
  }

  return (
    <div className="space-y-6 sm:max-w-sm">
      <div className="flex items-center gap-4">
        <Avatar
          username={session?.user?.username ?? ''}
          profile={profile}
          className="size-16 text-xl"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button-secondary"
            disabled={setAvatar.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            {profile.avatar_url ? 'Change photo' : 'Upload photo'}
          </button>
          {profile.avatar_url && (
            <button
              type="button"
              className="button-ghost"
              disabled={setAvatar.isPending}
              onClick={() =>
                setAvatar.mutate(null, { onError: (failure) => setError(failure.message) })
              }
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-label="Profile photo"
            className="hidden"
            onChange={(event) => {
              void pickPhoto(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
      </div>

      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault()
          setError(undefined)
          saveName.mutate(name.trim(), { onError: (failure) => setError(failure.message) })
        }}
      >
        <label htmlFor={nameId} className="block text-sm font-medium">
          Display name
        </label>
        <div className="flex gap-2">
          <input
            id={nameId}
            className="input"
            value={name}
            maxLength={80}
            placeholder="Your name"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="button-secondary shrink-0"
            disabled={name.trim() === profile.display_name || saveName.isPending}
          >
            Save
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Signs your public notes. Without one they show no author; your username never shows.
        </p>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
