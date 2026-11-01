import type { Peer } from './live'

// More than this and the rest are counted.
const SHOWN = 3

/** Who else is in the note: a dot in their cursor's color, and their name. */
export function Peers({ peers }: { peers: Peer[] }) {
  if (!peers.length) return null
  const shown = peers.slice(0, SHOWN)
  const names = peers.map((peer) => peer.name).join(', ')
  return (
    <span className="flex items-center gap-2 text-zinc-500" aria-label={`Also here: ${names}`} title={names}>
      {shown.map((peer) => (
        <span key={peer.id} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: peer.color }} aria-hidden="true" />
          <span className="hidden max-w-32 truncate sm:inline">{peer.name}</span>
        </span>
      ))}
      {peers.length > SHOWN && <span>+{peers.length - SHOWN}</span>}
    </span>
  )
}
