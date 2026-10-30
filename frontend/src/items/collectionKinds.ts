import { BookMarked, FolderKanban, Layers, type LucideIcon } from 'lucide-react'

import type { CollectionKind } from './api'

/** The PARA kinds, as the app shows them. */
export const COLLECTION_KINDS: {
  value: CollectionKind
  label: string
  hint: string
  icon: LucideIcon
}[] = [
  { value: 'project', label: 'Project', hint: 'A goal with an end', icon: FolderKanban },
  { value: 'area', label: 'Area', hint: 'An ongoing responsibility', icon: Layers },
  { value: 'resource', label: 'Resource', hint: 'A topic of interest', icon: BookMarked },
]

export function collectionKind(value: CollectionKind) {
  return COLLECTION_KINDS.find((kind) => kind.value === value) ?? COLLECTION_KINDS[0]
}
