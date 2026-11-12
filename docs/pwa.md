# Install on a phone (PWA)

BrainBro is an installable web app. It needs HTTPS, which a Cloudflare Tunnel or Caddy gives it
(see [deployment.md](deployment.md#how-it-is-reached)). On a plain `http://` address there is
no service worker, so no install and no share target.

- **Android (Chrome):** open the hostname, sign in, then *Install app* from the menu. BrainBro
  then shows up in the share sheet of every app: text, links, photos and files go straight to
  the inbox.
- **iOS (Safari):** *Share → Add to Home Screen*. iOS has no Web Share Target, so for photos and
  files use the **+** tab (the quick capture view). For links and text from other apps, make a
  Shortcut that shows in the share sheet, takes *URLs and Text*, runs *URL Encode* on the input
  and then *Open URL* with `https://<hostname>/share?text=<URL Encoded Text>`. BrainBro asks
  for a tap before saving. The Shortcut opens Safari, which on iOS doesn't share the installed
  app's sign-in, so sign in once in Safari too.

## How it is served

| Path | Served by | Notes |
|---|---|---|
| `/sw.js` | Django (`apps.core.views.pwa_file`) | From the frontend build, `Cache-Control: no-cache`. At the root so its scope is the whole app. |
| `/manifest.webmanifest` | Django (same view) | `no-cache` as well. |
| `POST /share` | The service worker | Android's share target. Stores the share in IndexedDB and opens the inbox, where the app sends it through the capture pipeline. If it ever reaches Django (no service worker yet), Django only redirects to `/share?lost=1`; it never creates items. |
| `/static/…` | whitenoise | The build. The service worker precaches the shell and caches other hashed assets once loaded. |

The service worker never touches `/api/`, `/admin/` or `/media/`: sessions, CSRF and uploaded
files always come from the server. Shares made offline or signed out stay on the phone and are
sent the next time BrainBro is open, signed in and online.

A deploy reaches installed apps on their next load, because of the `no-cache` header. Behind
Cloudflare, don't add a cache rule that overrides it for `/sw.js`. If you ever put Cloudflare
Access in front of BrainBro, the manifest is fetched without cookies: add
`crossorigin="use-credentials"` to its `<link>` in `frontend/index.html` or bypass Access for
`/manifest.webmanifest`.
