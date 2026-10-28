/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://localhost:8000'

export default defineConfig(({ command }) => ({
  // In production Django serves the build as static files under /static/.
  base: command === 'build' ? '/static/' : '/',
  plugins: [react(), tailwindcss()],
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
      '/api': backend,
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
