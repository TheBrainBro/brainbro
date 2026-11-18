import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useSettingsFooterSlot } from './navigation'

/**
 * A page's actions (Save and its status), pinned under the page in the
 * settings dialog so they show without scrolling. Outside the dialog they
 * render in place. Buttons in it reach their form with the `form` attribute.
 */
export function SettingsFooter({ children }: { children: ReactNode }) {
  const slot = useSettingsFooterSlot()
  if (slot) return createPortal(children, slot)
  return <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 pt-6">{children}</div>
}
