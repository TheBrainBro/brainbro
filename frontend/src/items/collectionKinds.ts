import { BookMarked, FolderKanban, Layers, type LucideIcon } from 'lucide-react'

import { t } from '../i18n/i18n'
import type { CollectionKind } from './api'

/** The PARA kinds, as the app shows them, in the language shown. */
export const COLLECTION_KINDS: {
  value: CollectionKind
  label: string
  hint: string
  icon: LucideIcon
}[] = [
  {
    value: 'project',
    get label() {
      return t('collectionKinds.project')
    },
    get hint() {
      return t('collectionKinds.projectHint')
    },
    icon: FolderKanban,
  },
  {
    value: 'area',
    get label() {
      return t('collectionKinds.area')
    },
    get hint() {
      return t('collectionKinds.areaHint')
    },
    icon: Layers,
  },
  {
    value: 'resource',
    get label() {
      return t('collectionKinds.resource')
    },
    get hint() {
      return t('collectionKinds.resourceHint')
    },
    icon: BookMarked,
  },
]

export function collectionKind(value: CollectionKind) {
  return COLLECTION_KINDS.find((kind) => kind.value === value) ?? COLLECTION_KINDS[0]
}

/** Colors a collection can have behind its emoji; '' is the default. */
export const COLLECTION_COLORS = [
  '',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#71717a',
]

/** A few emoji to start from; any other can be typed or pasted. */
export const SUGGESTED_EMOJI = [
  '📁', '🚀', '💼', '🏠', '❤️', '📚', '🎨', '💡', '🧠', '✈️',
  '💰', '🛠️', '🎯', '📈', '🌱', '🎵', '🍳', '🏃', '📝', '⭐',
]

/** The first character as people see it (one emoji, flags and skin tones included). */
export function firstGrapheme(text: string) {
  const [first] = new Intl.Segmenter().segment(text.trim())
  return first?.segment ?? ''
}
