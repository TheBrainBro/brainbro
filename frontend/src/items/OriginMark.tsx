import { Bot } from 'lucide-react'

import type { Item } from './api'
import { originText } from './origin'

/** A small mark on items an assistant made or last edited, saying which. */
export function OriginMark({ item }: { item: Item }) {
  const text = originText(item)
  if (!text) return null
  return (
    <span className="group/tip relative inline-flex shrink-0 rounded text-accent-600 dark:text-accent-300">
      <Bot className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{text}</span>
      <span className="tooltip bottom-full mb-1.5" aria-hidden="true">
        {text}
      </span>
    </span>
  )
}
