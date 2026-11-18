import { createContext, useContext } from 'react'

/**
 * Opens another page of the settings dialog, for links like "Set it up" that
 * point to where something is configured. Null outside the dialog.
 */
export const SettingsNavigation = createContext<((page: string) => void) | null>(null)

export function useOpenSettingsPage() {
  return useContext(SettingsNavigation)
}
