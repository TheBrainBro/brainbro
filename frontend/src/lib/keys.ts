export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** The modifier key as this system names it: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl'

/** A shortcut written for this system: `combo('Z', { shift: true })` is ⇧⌘Z or Ctrl+Shift+Z. */
export function combo(key: string, { shift = false }: { shift?: boolean } = {}) {
  if (isMac) return `${shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`
}
