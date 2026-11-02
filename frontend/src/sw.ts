/**
 * BrainBro's service worker, served by Django at /sw.js (scope /).
 *
 * - Precaches the app shell, so the app opens offline. Navigations go to the
 *   network first and fall back to it. Other build assets (hashed, so never
 *   stale) are cached the first time they load.
 * - Receives the Web Share Target (POST /share): stores what was shared in
 *   IndexedDB and opens the inbox, where the app sends it through the
 *   capture pipeline. It never creates items itself.
 * - Never touches the API, the admin or uploads: sessions, CSRF and files
 *   always come from the server.
 */
import { clientsClaim } from 'workbox-core'
import type { PrecacheEntry } from 'workbox-precaching'
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { saveShare } from './share/queue'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

const SERVER_ONLY = /^\/(api|admin|media|static)\//
const ASSETS = /^\/static\/assets\//
const ASSET_CACHE = 'brainbro-assets'

async function receiveShare(request: Request) {
  const origin = self.location.origin
  try {
    const form = await request.formData()
    const field = (name: string) => {
      const value = form.get(name)
      return typeof value === 'string' ? value : ''
    }
    await saveShare({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      title: field('title'),
      text: field('text'),
      url: field('url'),
      // A file field with nothing chosen still sends an empty, nameless part.
      files: form
        .getAll('files')
        .filter((value): value is File => value instanceof File && (value.size > 0 || !!value.name)),
    })
    return Response.redirect(`${origin}/`, 303)
  } catch {
    return Response.redirect(`${origin}/share?lost=1`, 303)
  }
}

// Before Workbox's router, which only handles GET.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share') {
    event.respondWith(receiveShare(event.request))
  }
})

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  ({ url, sameOrigin }) => sameOrigin && ASSETS.test(url.pathname),
  async ({ request }) => {
    const cache = await caches.open(ASSET_CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  },
)

registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        return await fetch(request)
      } catch {
        return (await matchPrecache('/static/index.html')) ?? Response.error()
      }
    },
    { denylist: [SERVER_ONLY] },
  ),
)

// A new version takes over open tabs at once: assets are hashed, so the old
// page keeps working until it reloads. Assets of older builds are dropped,
// also the cache from before the rename to BrainBro.
self.skipWaiting()
clientsClaim()
self.addEventListener('activate', (event) =>
  event.waitUntil(Promise.all([caches.delete(ASSET_CACHE), caches.delete('brain-assets')])),
)
