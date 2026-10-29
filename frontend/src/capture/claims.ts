const claimed = new WeakSet<Event>()

/**
 * Marks a paste, a drop or a dragover as taken by the element it happened
 * in (a note takes images into its text): the app-wide capture leaves it
 * alone, and hides its drop overlay while the drag is over that element.
 */
export function claimEvent(event: Event) {
  claimed.add(event)
}

export function isClaimed(event: Event) {
  return claimed.has(event)
}
