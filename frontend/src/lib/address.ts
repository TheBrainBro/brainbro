import { type Session, useSession } from '../auth/session'

/**
 * Where people outside reach this server: the public address an admin set
 * in Settings, Server, General, or the browser's own without one.
 * Every address the app shows or hands out starts with it. Connections the
 * browser makes to where it already is (live editing, the service worker)
 * keep `window.location`.
 */
export function appOrigin(session?: Session) {
  const publicUrl = session?.public_url ?? ''
  return /^https?:\/\//.test(publicUrl) ? publicUrl : window.location.origin
}

/** The server's address as people read it: `brain.example.com`. */
export function appHost(session?: Session) {
  return new URL(appOrigin(session)).host
}

export function useAppOrigin() {
  const { data: session } = useSession()
  return appOrigin(session)
}

export function useAppHost() {
  const { data: session } = useSession()
  return appHost(session)
}

/** A path on this server, `/@ana/trip`, as a full address; a blog's URL as is. */
export function useAppUrl() {
  const origin = useAppOrigin()
  return (path: string) => new URL(path, origin).href
}

/**
 * Where a hostname can be opened from: only this computer, only its local
 * network (`umbrel.local`, `192.168.1.20`, a name with no dots), or anywhere
 * (`null`, as far as can be told from the name).
 */
export function localReach(hostname: string): 'computer' | 'network' | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) {
    return 'computer'
  }
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return 'network'
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    const isPrivate =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      // Carrier-grade NAT, where Tailscale's addresses are.
      (a === 100 && b >= 64 && b <= 127)
    return isPrivate ? 'network' : null
  }
  if (host.includes(':')) return /^(fc|fd|fe[89ab])/.test(host) ? 'network' : null
  return host.includes('.') ? null : 'network'
}
