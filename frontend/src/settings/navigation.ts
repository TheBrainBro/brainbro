import { createContext, useContext } from 'react'

/**
 * Opens another page of the settings dialog, for links like "Set it up" that
 * point to where something is configured. Null outside the dialog.
 */
export const SettingsNavigation = createContext<((page: string) => void) | null>(null)

export function useOpenSettingsPage() {
  return useContext(SettingsNavigation)
}

/** Where a page's footer (its Save button) renders: pinned under the page, outside its scroll. */
export const SettingsFooterSlot = createContext<HTMLElement | null>(null)

export function useSettingsFooterSlot() {
  return useContext(SettingsFooterSlot)
}
