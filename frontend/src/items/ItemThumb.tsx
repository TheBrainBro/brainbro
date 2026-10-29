import { FileText, Image as ImageIcon, Link2, NotebookText } from 'lucide-react'
import { useState } from 'react'

import type { Item } from './api'

/** What to show of an item in a small square: its picture if it has one, else what it is. */
export function ItemThumb({ item, className = 'size-12' }: { item: Item; className?: string }) {
  const [broken, setBroken] = useState(false)
  const svg = item.metadata.mime === 'image/svg+xml' ? item.file_url : null
  const src = item.preview_image_url ?? svg
  const box = `${className} shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800`

  if (src && !broken) {
    return (
      <div className={box}>
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setBroken(true)}
        />
      </div>
    )
  }
  if (item.kind === 'file') {
    const extension = item.metadata.filename?.split('.').pop()?.slice(0, 4).toUpperCase()
    return (
      <div className={`${box} flex flex-col items-center justify-center gap-0.5 text-zinc-500`}>
        <FileText className="size-4" aria-hidden="true" />
        {extension && <span className="text-[9px] font-semibold">{extension}</span>}
      </div>
    )
  }
  const Icon = { note: NotebookText, link: Link2, image: ImageIcon }[item.kind]
  return (
    <div className={`${box} flex items-center justify-center text-zinc-500`}>
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
    </div>
  )
}
