import { Autosave, localDraftStore, type AutosaveState, type DraftStore as Store, type SaveStatus } from '../lib/autosave'

export type { SaveStatus }

/** The parts of a note the editor works with. */
export type SavedNote = { id: string; body: string }

export type Draft = { body: string }

/** Unsaved text kept on this device, so a reload or a dead network loses nothing. */
export type DraftStore = Store<Draft>

export type SaverOptions<T extends SavedNote> = {
  /** Creates the note (through the capture pipeline) from its first text. */
  create: (body: string) => Promise<T>
  onChange: (state: SaverState<T>) => void
  /** The note exists: from here on it is edited live. */
  onCreated?: (note: T) => void
  drafts: DraftStore
  debounceMs?: number
}

export type SaverState<T extends SavedNote = SavedNote> = AutosaveState<T>

const DEBOUNCE_MS = 800

export const NEW_NOTE = 'new'

/**
 * A new note until it exists: created on its first text (see `Autosave` for
 * the timing), with a draft on this device meanwhile. Once created it saves
 * nothing more: the note is edited live (see `LiveNote`), starting from
 * whatever was typed by then.
 */
export class NoteSaver<T extends SavedNote = SavedNote> {
  private created: T | null = null
  private text = ''
  private options: SaverOptions<T>
  private autosave: Autosave<T>

  constructor(options: SaverOptions<T>) {
    this.options = options
    this.autosave = new Autosave<T>({
      // A new note only exists once it has something in it.
      dirty: () => !this.created && this.text.trim() !== '',
      save: () => this.send(),
      onClean: () => this.options.drafts.remove(NEW_NOTE),
      onChange: options.onChange,
      debounceMs: options.debounceMs ?? DEBOUNCE_MS,
    })
  }

  /** What the editor holds, including what was typed after the note was created. */
  get body() {
    return this.text
  }

  get noteId() {
    return this.created?.id ?? null
  }

  get status() {
    return this.autosave.status
  }

  get snapshot() {
    return this.autosave.snapshot
  }

  /** Picks up a new note's draft left by an earlier visit; `resume` saves it. */
  restoreDraft() {
    const draft = this.options.drafts.get(NEW_NOTE)
    if (!draft?.body) return
    this.text = draft.body
    this.autosave.init({ status: 'unsaved' })
  }

  /** Saves a restored draft (once the editor is up). */
  resume() {
    if (this.status === 'unsaved') this.autosave.changed()
  }

  edit(body: string) {
    this.text = body
    if (this.created || this.autosave.isStopped) return
    this.options.drafts.set(NEW_NOTE, { body })
    this.autosave.changed()
  }

  private async send() {
    const note = await this.options.create(this.text)
    this.created = note
    this.options.drafts.remove(NEW_NOTE)
    this.options.onCreated?.(note)
  }

  /** Saves now. `keepalive` is ignored: creating a note needs an answer. */
  flush() {
    return this.autosave.flush()
  }

  /** Back online: retry straight away instead of waiting out the backoff. */
  retryNow() {
    this.autosave.retryNow()
  }

  /** Mounted (again): failed saves retry. */
  attach() {
    this.autosave.attach()
  }

  /** Leaving: save what's left and stop the timers. */
  dispose() {
    this.autosave.dispose()
  }
}

/** Drafts in localStorage; quietly does nothing where storage is unavailable. */
export const localDrafts: DraftStore = localDraftStore<Draft>('brain:note-draft:')
