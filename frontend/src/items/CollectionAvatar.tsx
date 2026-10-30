import type { Collection } from './api'
import { collectionKind } from './collectionKinds'

const SIZES = {
  sm: { box: 'size-5 rounded-md text-xs', icon: 'size-3.5' },
  md: { box: 'size-10 rounded-lg text-lg', icon: 'size-5' },
  lg: { box: 'size-14 rounded-xl text-2xl', icon: 'size-7' },
}

/** A collection's face: its image, or its emoji on its color, or its kind's icon. */
export function CollectionAvatar({
  collection,
  size = 'md',
}: {
  collection: Pick<Collection, 'kind' | 'icon' | 'color' | 'image_url'>
  size?: keyof typeof SIZES
}) {
  const { box, icon } = SIZES[size]
  const base = `flex shrink-0 items-center justify-center overflow-hidden ${box}`
  if (collection.image_url) {
    return <img src={collection.image_url} alt="" className={`${base} object-cover`} />
  }
  const Icon = collectionKind(collection.kind).icon
  return (
    <span
      aria-hidden="true"
      className={`${base} ${collection.color ? '' : 'bg-accent-50 text-accent-600 dark:bg-accent-500/10 dark:text-accent-300'}`}
      // A tint of the color, so the emoji reads on it in both themes.
      style={collection.color ? { background: `${collection.color}33`, color: collection.color } : undefined}
    >
      {collection.icon || <Icon className={icon} strokeWidth={1.75} />}
    </span>
  )
}
