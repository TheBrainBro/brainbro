import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/fredoka/600.css'
import '@fontsource/fredoka/700.css'
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import './index.css'
import App from './App.tsx'
import { siteHostname } from './public/api'

// Served on a blog's own domain: the blog, not the app.
const site = siteHostname() !== null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App site={site} />
  </StrictMode>,
)

// Production only: in development Vite serves modules the worker can't precache.
// A blog is no app to install.
if (import.meta.env.PROD && !site && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' })
  })
}
