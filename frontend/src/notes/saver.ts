import { ApiError } from '../lib/api'
import {
  Autosave,
  localDraftStore,
  type AutosaveState,
  type DraftStore as Store,
  type SaveStatus,
} from '../lib/autosave'

export type { SaveStatus }

/** The parts of a note the editor works with. */
export type SavedNote = { id: string; body: string; version: string }

export type Draft = { body: string; base: string | null }

/** Unsaved text kept on this device, so a reload or a dead network loses nothing. */
export type DraftStore = Store<Draft>

export type SaverOptions<T extends SavedNote> = {
  /** Creates the note (through the capture pipeline) from its first text. */
  create: (body: string) => Promise<T>
  /** Saves the body if the server still has `version`; rejects with a 412 ApiError otherwise. */
  update: (id: string, body: string, version: string, options: { keepalive: boolean }) => Promise<T>
  onChange: (state: SaverState<T>) => void
  onSaved?: (note: T, created: boolean) => void
  drafts: DraftStore
  debounceMs?: number
}

/** `theirs`: the server's newer text when another tab or device saved first. */
export type SaverState<T extends SavedNote = SavedNote> = AutosaveState<T>

const DEBOUNCE_MS = 800
// Browsers refuse keepalive requests over 64 KiB; the draft covers bigger ones.
const KEEPALIVE_MAX_CHARS = 30_000

export const NEW_NOTE = 'new'

/**
 * Autosave for one note (see `Autosave` for the timing): drafts on this
 * device, and a new note created on its first text.
 */
export class NoteSaver<T extends SavedNote = SavedNote> {
  private id: string | null
  private base: T | null
  private text: string
  private options: SaverOptions<T>
  private autosave: Autosave<T>
  private loads = 0

  constructor(note: T | null, options: SaverOptions<T>) {
    this.options = options
    this.id = note?.id ?? null
    this.base = note
    this.text = note?.body ?? ''
    this.autosave = new Autosave<T>({
      // A new note only exists once it has something in it.
      dirty: () => (this.id ? this.text !== this.base?.body : this.text.trim() !== ''),
      save: (saveOptions) => this.send(saveOptions),
      onClean: () => this.options.drafts.remove(this.draftKey),
      describe: (error) =>
        error instanceof ApiError && error.status === 404
          ? 'This note no longer exists.'
          : undefined,
      onChange: options.onChange,
      debounceMs: options.debounceMs ?? DEBOUNCE_MS,
    })
  }

  get body() {
    return this.text
  }

  get noteId() {
    return this.id
  }

  get status() {
    return this.autosave.status
  }

  get snapshot() {
    return this.autosave.snapshot
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
    this.autosave.init(
      this.base && draft.base !== this.base.version
        ? { status: 'conflict', theirs: this.base }
        : { status: 'unsaved' },
    )
  }

  /** Saves a restored draft (once the editor is up). */
  resume() {
    if (this.status === 'unsaved') this.autosave.changed()
  }

  edit(body: string) {
    if (this.autosave.isStopped) return
    this.text = body
    this.options.drafts.set(this.draftKey, { body, base: this.base?.version ?? null })
    this.autosave.changed()
  }

  /** Text from the server replaces ours (it changed elsewhere and we had nothing pending). */
  load(note: T) {
    this.base = note
    this.text = note.body
    this.loads++
    this.options.drafts.remove(this.draftKey)
    this.autosave.reset()
  }

  /** Ends a conflict: `theirs` drops our text, `mine` saves it over theirs. */
  resolve(side: 'theirs' | 'mine') {
    const theirs = this.snapshot.theirs
    if (this.status !== 'conflict' || !theirs) return
    if (side === 'theirs') {
      this.load(theirs)
      return
    }
    this.base = theirs
    this.autosave.resume()
  }

  private async send({ keepalive }: { keepalive: boolean }) {
    const body = this.text
    const created = !this.id
    const saved = this.id
      ? await this.options.update(this.id, body, this.base!.version, {
          keepalive: keepalive && body.length <= KEEPALIVE_MAX_CHARS,
        })
      : await this.options.create(body)
    if (created) this.options.drafts.remove(NEW_NOTE)
    this.id = saved.id
    this.base = saved
    this.options.onSaved?.(saved, created)
    // Typed while saving: keep the draft current for the next round.
    if (this.text !== saved.body) {
      this.options.drafts.set(this.draftKey, { body: this.text, base: saved.version })
    }
  }

  /** Saves now. `keepalive` lets the request outlive the page (closing the tab). */
  flush(options: { keepalive?: boolean } = {}) {
    return this.autosave.flush(options)
  }

  /** Back online: retry straight away instead of waiting out the backoff. */
  retryNow() {
    this.autosave.retryNow()
  }

  /** The note was deleted: drop pending edits and the draft, and never save again. */
  discard() {
    this.autosave.stop()
    this.options.drafts.remove(this.draftKey)
  }

  /** Mounted (again): failed saves retry. */
  attach() {
    this.autosave.attach()
  }

  /** Leaving the note: save what's left and stop the timers. */
  dispose(options: { keepalive?: boolean } = {}) {
    this.autosave.dispose(options)
  }
}

/** Drafts in localStorage; quietly does nothing where storage is unavailable. */
export const localDrafts: DraftStore = localDraftStore<Draft>('brain:note-draft:')
