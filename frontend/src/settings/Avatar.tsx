import type { Profile } from '../auth/session'

/** The user's photo, or the first letter of their name on the accent color. */
export function Avatar({
  username,
  profile,
  className = 'size-9 text-sm',
}: {
  username: string
  profile?: Profile
  className?: string
}) {
  if (profile?.avatar_url) {
    return (
      <img src={profile.avatar_url} alt="" className={`rounded-full object-cover ${className}`} />
    )
  }
  const initial = (profile?.display_name || username).slice(0, 1) || '?'
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-accent-400 to-accent-600 font-semibold text-white uppercase ${className}`}
    >
      {initial}
    </span>
  )
}
