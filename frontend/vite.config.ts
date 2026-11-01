/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const backend = 'http://localhost:8000'
// Keeps the browser's Host (localhost:5173), so the URLs Django builds from
// it, like the OAuth ones AI assistants follow, point back at Vite.
const sameHost = { target: backend, changeOrigin: false }

// The build's public files are under /static/ (see `base`).
const icon = (name: string) => `/static/icons/${name}`

export default defineConfig(({ command }) => ({
  // In production Django serves the build as static files under /static/.
  base: command === 'build' ? '/static/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Manifest and service worker (src/sw.ts). Django serves both from the
    // root (apps.core.views.pwa_file), so the scope is the whole app.
    VitePWA({
      base: '/',
      scope: '/',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      injectManifest: {
        // The shell and what the inbox loads. Lazy chunks (the editor, its
        // ~100 language modes) are cached by src/sw.ts once first used.
        globPatterns: [
          'index.html',
          'favicon.svg',
          'icons/*.png',
          'assets/{index,rolldown-runtime,markdown}-*.{js,css}',
        ],
        // Paths in the precache list are where Django serves them.
        modifyURLPrefix: { '': '/static/' },
      },
      manifest: {
        id: '/',
        name: 'Brain',
        short_name: 'Brain',
        description: 'Drop it now, sort it later.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fafafa',
        // One color for every theme: the launch screen is light, like background_color.
        theme_color: '#ffffff',
        icons: [
          { src: icon('pwa-192x192.png'), sizes: '192x192', type: 'image/png' },
          { src: icon('pwa-512x512.png'), sizes: '512x512', type: 'image/png' },
          {
            src: icon('maskable-icon-512x512.png'),
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Capture', url: '/capture' },
          { name: 'New note', url: '/notes/new' },
        ],
        // Android: share from any app into the inbox (handled in src/sw.ts).
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['*/*'] }],
          },
        },
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // The Markdown engine (and its emoji data) in its own chunk, cached
        // apart from app code that changes more often.
        codeSplitting: {
          groups: [
            {
              name: 'markdown',
              test: /node_modules[\\/](markdown-it|linkify-it|mdurl|uc\.micro|entities|punycode|dompurify)/,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      // ws: live note editing (/api/live/notes/…).
      '/api': { ...sameHost, ws: true },
      // OAuth discovery for AI assistants (MCP).
      '/.well-known': sameHost,
      '/admin': backend,
      '/static/admin': backend,
      '/static/unfold': backend,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
}))
