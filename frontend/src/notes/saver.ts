import { ApiError } from '../lib/api'

/** What the save indicator shows. `unsaved` is the debounce, before a save starts. */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'offline' | 'error' | 'conflict'

/** The parts of a note the editor works with. */
export type SavedNote = { id: string; body: string; version: string }

export type Draft = { body: string; base: string | null }

/** Unsaved text kept on this device, so a reload or a dead network loses nothing. */
export type DraftStore = {
  get: (key: string) => Draft | null
  set: (key: string, draft: Draft) => void
  remove: (key: string) => void
}

export type SaverOptions<T extends SavedNote> = {
  /** Creates the note (through the capture pipeline) from its first text. */
  create: (body: string) => Promise<T>
  /** Saves the body if the server still has `version`; rejects with a 412 ApiError otherwise. */
  update: (
    id: string,
    body: string,
    version: string,
    options: { keepalive: boolean },
  ) => Promise<T>
  onChange: (state: SaverState<T>) => void
  onSaved?: (note: T, created: boolean) => void
  drafts: DraftStore
  debounceMs?: number
}

export type SaverState<T extends SavedNote = SavedNote> = {
  status: SaveStatus
  error?: string
  /** The server's newer text when another tab or device saved first. */
  theirs?: T
}

const DEBOUNCE_MS = 800
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30_000
// Browsers refuse keepalive requests over 64 KiB; the draft covers bigger ones.
const KEEPALIVE_MAX_CHARS = 30_000

export const NEW_NOTE = 'new'

function isOffline(error: unknown) {
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    error instanceof TypeError
  )
}

function retryable(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 429
}

/**
 * Autosave for one note: debounced, one request at a time (edits made while
 * a save is in flight go in the next one), retried with backoff while the
 * network is down, and stopped on a conflict until the user picks a side.
 */
export class NoteSaver<T extends SavedNote = SavedNote> {
  private id: string | null
  private base: T | null
  private text: string
  private state: SaverState<T> = { status: 'saved' }
  private timer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryDelay = RETRY_MIN_MS
  private inFlight = false
  private again = false
  private options: SaverOptions<T>
  private loads = 0

  constructor(note: T | null, options: SaverOptions<T>) {
    this.options = options
    this.id = note?.id ?? null
    this.base = note
    this.text = note?.body ?? ''
  }

  get body() {
    return this.text
  }

  get noteId() {
    return this.id
  }

  get status() {
    return this.state.status
  }

  get snapshot() {
    return this.state
  }

  /** Goes up each time text from elsewhere replaces ours: the editor remounts on it. */
  get generation() {
    return this.loads
  }

  /** The server version our text is based on. */
  get version() {
    return this.base?.version ?? null
  }

  private get draftKey() {
    return this.id ?? NEW_NOTE
  }

  private get dirty() {
    return this.text !== (this.base?.body ?? '')
  }

  private set(state: SaverState<T>) {
    const same =
      state.status === this.state.status &&
      state.error === this.state.error &&
      state.theirs === this.state.theirs
    if (same) return
    this.state = state
    this.options.onChange(state)
  }

  /**
   * Picks up a draft left by an earlier visit, before the editor shows the
   * text: kept as unsaved if it was written on top of what the server still
   * has, as a conflict otherwise. No timers or callbacks; `resume` starts
   * saving it.
   */
  restoreDraft() {
    const draft = this.options.drafts.get(this.draftKey)
    if (!draft || draft.body === this.text) return
    this.text = draft.body
    this.state =
      this.base && draft.base !== this.base.version
        ? { status: 'conflict', theirs: this.base }
        : { status: 'unsaved' }
  }

  /** Saves a restored draft (once the editor is up). */
  resume() {
    if (this.state.status === 'unsaved') this.schedule()
  }

  edit(body: string) {
    this.text = body
    this.options.drafts.set(this.draftKey, { body, base: this.base?.version ?? null })
    if (this.state.status === 'conflict') return
    this.schedule()
  }

  /** Text from the server replaces ours (it changed elsewhere and we had nothing pending). */
  load(note: T) {
    this.base = note
    this.text = note.body
    this.loads++
    this.options.drafts.remove(this.draftKey)
    // Always tell: even when the status stays `saved`, the text changed.
    this.state = { status: 'saved' }
    this.options.onChange(this.state)
  }

  /** Ends a conflict: `theirs` drops our text, `mine` saves it over theirs. */
  resolve(side: 'theirs' | 'mine') {
    const theirs = this.state.theirs
    if (this.state.status !== 'conflict' || !theirs) return
    if (side === 'theirs') {
      this.load(theirs)
      return
    }
    this.base = theirs
    this.set({ status: 'unsaved' })
    this.flush()
  }

  private schedule() {
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    this.set({ status: 'unsaved' })
    this.timer = setTimeout(() => this.flush(), this.options.debounceMs ?? DEBOUNCE_MS)
  }

  /** Saves now. `keepalive` lets the request outlive the page (closing the tab). */
  async flush({ keepalive = false } = {}) {
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    if (this.state.status === 'conflict') return
    if (this.inFlight) {
      this.again = true
      return
    }
    if (!this.dirty) {
      this.options.drafts.remove(this.draftKey)
      if (this.state.status !== 'saved') this.set({ status: 'saved' })
      return
    }
    // A new note only exists once it has something in it.
    if (!this.id && !this.text.trim()) {
      this.options.drafts.remove(this.draftKey)
      this.set({ status: 'saved' })
      return
    }

    const body = this.text
    this.inFlight = true
    this.set({ status: 'saving' })
    try {
      const created = !this.id
      const saved = this.id
        ? await this.options.update(this.id, body, this.base!.version, {
            keepalive: keepalive && body.length <= KEEPALIVE_MAX_CHARS,
          })
        : await this.options.create(body)
      if (created) this.options.drafts.remove(NEW_NOTE)
      this.id = saved.id
      this.base = saved
      this.retryDelay = RETRY_MIN_MS
      this.options.onSaved?.(saved, created)
      if (this.dirty) {
        // Typed while saving: keep the draft current and go again.
        this.options.drafts.set(this.draftKey, { body: this.text, base: saved.version })
        this.again = true
      } else {
        this.options.drafts.remove(this.draftKey)
        this.set({ status: 'saved' })
      }
    } catch (error) {
      this.again = false
      if (error instanceof ApiError && error.status === 412) {
        this.set({ status: 'conflict', theirs: error.data as T })
      } else if (error instanceof ApiError && error.status === 404) {
        this.set({ status: 'error', error: 'This note no longer exists.' })
      } else if (retryable(error)) {
        const offline = isOffline(error)
        this.set({
          status: offline ? 'offline' : 'error',
          error: offline ? undefined : error instanceof Error ? error.message : 'Save failed',
        })
        this.retryTimer = setTimeout(() => this.flush(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS)
      } else {
        this.set({ status: 'error', error: (error as Error).message })
      }
    } finally {
      this.inFlight = false
    }
    if (this.again) {
      this.again = false
      await this.flush({ keepalive })
    }
  }

  /** Back online: retry straight away instead of waiting out the backoff. */
  retryNow() {
    if (this.state.status === 'offline' || this.state.status === 'error') {
      this.retryDelay = RETRY_MIN_MS
      this.flush()
    }
  }

  /** Leaving the note: save what's left and stop the timers. */
  dispose({ keepalive = false } = {}) {
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    if (this.dirty && this.state.status !== 'conflict') this.flush({ keepalive })
  }
}

/** Drafts in localStorage; quietly does nothing where storage is unavailable. */
export const localDrafts: DraftStore = {
  get(key) {
    try {
      const raw = localStorage.getItem(`brain:note-draft:${key}`)
      return raw ? (JSON.parse(raw) as Draft) : null
    } catch {
      return null
    }
  },
  set(key, draft) {
    try {
      localStorage.setItem(`brain:note-draft:${key}`, JSON.stringify(draft))
    } catch {
      // Full or blocked: the save itself still goes ahead.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(`brain:note-draft:${key}`)
    } catch {
      // As above.
    }
  },
}
