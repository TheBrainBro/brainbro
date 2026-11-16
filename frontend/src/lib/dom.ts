import { useSyncExternalStore } from 'react'

/** Whether a keyboard event target takes text input, so shortcuts stay out of its way. */
export function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** Whether a media query matches, kept up to date. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** A random id. Not crypto.randomUUID: it needs HTTPS, and the app may be on a LAN address. */
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Copies text. Over plain HTTP there is no `navigator.clipboard`, so it goes through a hidden field. */
export async function copyText(text: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text)
  const focused = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.focus()
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (focused instanceof HTMLElement) focused.focus()
  if (!copied) throw new Error('Could not copy.')
}
