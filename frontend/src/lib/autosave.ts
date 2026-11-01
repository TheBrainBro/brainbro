import { t } from '../i18n/i18n'
import { ApiError } from './api'

/** What a save indicator shows. `unsaved` is the debounce, before a save starts. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'conflict'

export type AutosaveState<Theirs> = {
  status: SaveStatus
  error?: string
  /** The server's side when another tab or device saved first (the 412's body). */
  theirs?: Theirs
}

export type AutosaveOptions<Theirs> = {
  /** Whether what is held here differs from what the server has. */
  dirty: () => boolean
  /**
   * Saves what is held now and takes in the result. Rejects as the request
   * did: a 412 ApiError (with the server's side as its data) is a conflict.
   */
  save: (options: { keepalive: boolean }) => Promise<void>
  /** Everything is saved: drop the draft. */
  onClean?: () => void
  /** The message for an error retrying won't fix; undefined keeps the error's own. */
  describe?: (error: unknown) => string | undefined
  onChange: (state: AutosaveState<Theirs>) => void
  debounceMs: number
  /** Save at most this long after the first unsaved change, even if changes keep coming. */
  maxWaitMs?: number
}

const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30_000

function isOffline(error: unknown) {
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) || error instanceof TypeError
  )
}

function retryable(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 429
}

/**
 * The timing of an autosave, whatever it saves (a note's text, a board's
 * layout): debounced, one request at a time (changes made while a save is in
 * flight go in the next one), retried with backoff while the network is
 * down, and stopped on a conflict until the owner resolves it.
 */
export class Autosave<Theirs> {
  private state: AutosaveState<Theirs> = { status: 'saved' }
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryDelay = RETRY_MIN_MS
  private inFlight = false
  private again = false
  private stopped = false
  // Left (unmounted): one last try, no retries; the draft brings it back next time.
  private left = false
  private firstChange: number | undefined
  private options: AutosaveOptions<Theirs>

  constructor(options: AutosaveOptions<Theirs>) {
    this.options = options
  }

  get status() {
    return this.state.status
  }

  get snapshot() {
    return this.state
  }

  get isStopped() {
    return this.stopped
  }

  private set(state: AutosaveState<Theirs>) {
    const same =
      state.status === this.state.status &&
      state.error === this.state.error &&
      state.theirs === this.state.theirs
    if (same) return
    this.state = state
    this.options.onChange(state)
  }

  private clearTimers() {
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
  }

  /** Starts from a restored draft (unsaved, or a conflict) without telling anyone yet. */
  init(state: AutosaveState<Theirs>) {
    this.state = state
  }

  /** Something changed: save it once changes stop for a moment. */
  changed() {
    if (this.stopped || this.state.status === 'conflict') return
    this.clearTimers()
    this.set({ status: 'unsaved' })
    const now = Date.now()
    this.firstChange ??= now
    const { debounceMs, maxWaitMs } = this.options
    const wait =
      maxWaitMs === undefined
        ? debounceMs
        : Math.min(debounceMs, this.firstChange + maxWaitMs - now)
    this.timer = setTimeout(() => this.flush(), Math.max(wait, 0))
  }

  /** Saves now. `keepalive` lets the request outlive the page (closing the tab). */
  async flush({ keepalive = false } = {}) {
    this.clearTimers()
    if (this.stopped || this.state.status === 'conflict') return
    if (this.inFlight) {
      this.again = true
      return
    }
    this.firstChange = undefined
    if (!this.options.dirty()) {
      this.options.onClean?.()
      this.set({ status: 'saved' })
      return
    }

    this.inFlight = true
    this.set({ status: 'saving' })
    try {
      await this.options.save({ keepalive })
      this.retryDelay = RETRY_MIN_MS
      if (this.options.dirty()) {
        // Changed while saving: go again.
        this.again = true
      } else {
        this.options.onClean?.()
        this.set({ status: 'saved' })
      }
    } catch (error) {
      this.again = false
      if (error instanceof ApiError && error.status === 412) {
        this.set({ status: 'conflict', theirs: error.data as Theirs })
      } else if (retryable(error)) {
        const offline = isOffline(error)
        this.set({
          status: offline ? 'offline' : 'error',
          error: offline ? undefined : error instanceof Error ? error.message : t('errors.saveFailed'),
        })
        if (!this.left) {
          this.retryTimer = setTimeout(() => this.flush(), this.retryDelay)
          this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS)
        }
      } else {
        this.set({
          status: 'error',
          error: this.options.describe?.(error) ?? (error as Error).message,
        })
      }
    } finally {
      this.inFlight = false
    }
    if (this.again) {
      this.again = false
      await this.flush({ keepalive })
    }
  }

  /**
   * Saved elsewhere while something here is pending: stop and let the owner
   * choose. A save in flight finds out from its own answer (a 412).
   */
  conflict(theirs: Theirs) {
    if (this.stopped || this.inFlight) return
    this.clearTimers()
    this.firstChange = undefined
    this.set({ status: 'conflict', theirs })
  }

  /** Ends a conflict on our side: the owner has rebased onto theirs, save over it now. */
  resume() {
    if (this.stopped) return
    this.set({ status: 'unsaved' })
    this.flush()
  }

  /** What is held is now what the server has (theirs was taken): back to saved. */
  reset() {
    this.clearTimers()
    this.firstChange = undefined
    // Always tell: even when the status stays `saved`, the content changed.
    this.state = { status: 'saved' }
    this.options.onChange(this.state)
  }

  /** Back online: retry straight away instead of waiting out the backoff. */
  retryNow() {
    if (this.state.status === 'offline' || this.state.status === 'error') {
      this.retryDelay = RETRY_MIN_MS
      this.flush()
    }
  }

  /** Never save again (what was being saved is gone). */
  stop() {
    this.stopped = true
    this.clearTimers()
  }

  /** In use (again): failed saves retry. Undoes `dispose`, as a remount does. */
  attach() {
    this.left = false
  }

  /** Leaving: save what's left, once, and stop the timers. */
  dispose({ keepalive = false } = {}) {
    this.clearTimers()
    this.left = true
    if (this.options.dirty() && this.state.status !== 'conflict') this.flush({ keepalive })
  }
}

/** Something kept on this device under a key, such as unsaved work. */
export type DraftStore<T> = {
  get: (key: string) => T | null
  set: (key: string, draft: T) => void
  remove: (key: string) => void
}

/** Drafts in localStorage under `prefix`; quietly does nothing where storage is unavailable. */
export function localDraftStore<T>(prefix: string): DraftStore<T> {
  return {
    get(key) {
      try {
        const raw = localStorage.getItem(`${prefix}${key}`)
        return raw ? (JSON.parse(raw) as T) : null
      } catch {
        return null
      }
    },
    set(key, draft) {
      try {
        localStorage.setItem(`${prefix}${key}`, JSON.stringify(draft))
      } catch {
        // Full or blocked: the save itself still goes ahead.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(`${prefix}${key}`)
      } catch {
        // As above.
      }
    },
  }
}
