import { createContext, useContext } from 'react'

export type ToastAction = { label: string; onClick: () => void }

export type Toast = {
  /** Showing a toast with an id already on screen updates it in place. */
  id?: string
  message: string
  actions?: ToastAction[]
  /** Smaller lines under the message (what failed and why). */
  details?: string[]
  tone?: 'default' | 'error'
  /** Milliseconds on screen; `null` keeps it until it is dismissed. */
  duration?: number | null
}

export type ConfirmRequest = {
  title: string
  message?: string
  /** The confirming button's label ("Delete"). */
  confirm: string
  /** Destructive actions get a red button. */
  danger?: boolean
}

export type Feedback = {
  /** Shows a toast at the bottom of the screen; returns its id. */
  toast: (toast: Toast) => string
  dismissToast: (id: string) => void
  /** Asks in a dialog; resolves to whether the user confirmed. */
  confirm: (request: ConfirmRequest) => Promise<boolean>
}

export const FeedbackContext = createContext<Feedback | null>(null)

export function useFeedback() {
  const feedback = useContext(FeedbackContext)
  if (!feedback) throw new Error('useFeedback needs a FeedbackProvider')
  return feedback
}
