const LIMIT = 100

/**
 * Undo and redo over snapshots of the canvas. `present` is what is shown;
 * each committed change pushes the one before it.
 */
export class History<T> {
  present: T
  private past: T[] = []
  private future: T[] = []
  private limit: number

  constructor(present: T, limit = LIMIT) {
    this.present = present
    this.limit = limit
  }

  get canUndo() {
    return this.past.length > 0
  }

  get canRedo() {
    return this.future.length > 0
  }

  push(next: T) {
    this.past.push(this.present)
    if (this.past.length > this.limit) this.past.shift()
    this.present = next
    this.future = []
  }

  /** Replaces what is shown without an undo step (the server's version after a conflict). */
  reset(present: T) {
    this.present = present
    this.past = []
    this.future = []
  }

  undo(): T | undefined {
    const previous = this.past.pop()
    if (previous === undefined) return undefined
    this.future.push(this.present)
    this.present = previous
    return previous
  }

  redo(): T | undefined {
    const next = this.future.pop()
    if (next === undefined) return undefined
    this.past.push(this.present)
    this.present = next
    return next
  }
}
