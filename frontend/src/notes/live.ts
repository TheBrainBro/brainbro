import { useMemo, useSyncExternalStore } from 'react'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

import { myPresence } from '../live/presence'

/**
 * `live`: connected and up to date. `offline`: edits stay on this device and
 * merge when it reconnects. `closed`: the server won't let it edit (the note
 * is gone, or the session ended).
 */
export type LiveStatus = 'connecting' | 'live' | 'offline' | 'closed'

/** Someone else in the note: another session, or an assistant that just edited it. */
export type Peer = { id: number; name: string; color: string; assistant: boolean }

export type LiveState = {
  /** There is text to show and edit: from the server, or kept on this device. */
  ready: boolean
  status: LiveStatus
  peers: Peer[]
}

// The shared text's name, as the server binds it (backend apps.collab.text).
const TEXT = 'body'

const IDLE: LiveState = { ready: false, status: 'connecting', peers: [] }

function liveUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/api/live/notes`
}

function storageName(id: string) {
  return `brainbro:note:${id}`
}

/** Drops what this device keeps of a note, once it is deleted. */
export function forgetLiveNote(id: string) {
  return clearDocument(storageName(id)).catch(() => {})
}

/** Where `before` and `after` start and stop differing, never inside a surrogate pair. */
function differingRange(before: string, after: string) {
  const limit = Math.min(before.length, after.length)
  let start = 0
  while (start < limit && before[start] === after[start]) start++
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--
  let end = 0
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  if (end > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - end])) end--
  return { start, removed: before.length - start - end, inserted: after.slice(start, after.length - end) }
}

/**
 * A note open for live editing (backend apps.collab): its shared document,
 * synced over a WebSocket with every other session that has it open, and
 * kept on this device (IndexedDB) so edits made offline merge on reconnect.
 *
 * The text only ever comes from the server or from this device's copy of
 * it: building it here from the note's Markdown would merge in twice.
 */
export class LiveNote {
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText(TEXT)
  /** Undoes this session's edits only, never the others'. */
  readonly undoManager = new Y.UndoManager(this.text)
  readonly provider: WebsocketProvider
  private stored: IndexeddbPersistence | null
  private storedReady = false
  private closed = false
  private state = IDLE
  private listeners = new Set<() => void>()

  constructor(
    id: string,
    { url = liveUrl(), WebSocket: socket }: { url?: string; WebSocket?: typeof WebSocket } = {},
  ) {
    this.stored =
      typeof indexedDB === 'undefined' ? null : new IndexeddbPersistence(storageName(id), this.doc)
    this.provider = new WebsocketProvider(url, id, this.doc, socket ? { WebSocketPolyfill: socket } : {})
    this.provider.awareness.setLocalStateField('user', myPresence())
    this.provider.on('status', this.update)
    this.provider.on('sync', this.update)
    this.provider.on('closed', () => {
      this.closed = true
      this.update()
    })
    this.provider.awareness.on('change', this.update)
    this.stored?.whenSynced.then(() => {
      this.storedReady = true
      this.update()
    })
    window.addEventListener('online', this.update)
    window.addEventListener('offline', this.update)
  }

  get awareness() {
    return this.provider.awareness
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.state

  /**
   * Makes the text read `target`, changing only what differs: what was
   * typed into a new note while it was being created and connected.
   */
  setText(target: string) {
    const { start, removed, inserted } = differingRange(this.text.toString(), target)
    if (!removed && !inserted) return
    this.doc.transact(() => {
      if (removed) this.text.delete(start, removed)
      if (inserted) this.text.insert(start, inserted)
    })
  }

  private update = () => {
    const provider = this.provider
    const offline =
      navigator.onLine === false ||
      // Lost, or tried a couple of times without getting through.
      (!provider.wsconnected && provider.wsUnsuccessfulReconnects > 1)
    const status: LiveStatus = this.closed
      ? 'closed'
      : provider.wsconnected && provider.synced
        ? 'live'
        : offline
          ? 'offline'
          : 'connecting'
    // Once there is text it stays up, whatever the connection does.
    const kept = this.storedReady && (this.doc.store.clients.size > 0 || offline)
    const ready = this.state.ready || provider.synced || kept
    const peers: Peer[] = []
    this.awareness.getStates().forEach((state, id) => {
      if (id === this.doc.clientID || !state.user) return
      peers.push({ id, name: state.user.name, color: state.user.color, assistant: Boolean(state.assistant) })
    })
    const next = { ready, status, peers }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  destroy() {
    window.removeEventListener('online', this.update)
    window.removeEventListener('offline', this.update)
    this.listeners.clear()
    this.provider.destroy()
    this.stored?.destroy()
    this.undoManager.destroy()
    this.doc.destroy()
  }
}

type OpenLiveNote = LiveState & { live: LiveNote | null }

const CLOSED: OpenLiveNote = { ...IDLE, live: null }

/**
 * Opens the note live while something is subscribed: React subscribes once
 * the component is mounted and unsubscribes when it goes, which closes it.
 */
function liveNoteStore(id: string | null) {
  let snapshot = CLOSED
  return {
    subscribe(listener: () => void) {
      if (!id) return () => {}
      const note = new LiveNote(id)
      const publish = () => {
        snapshot = { ...note.getSnapshot(), live: note }
        listener()
      }
      const stop = note.subscribe(publish)
      publish()
      return () => {
        stop()
        note.destroy()
        snapshot = CLOSED
      }
    },
    getSnapshot: () => snapshot,
  }
}

/** The note open live while the component is mounted (null: none yet), and its state. */
export function useLiveNote(id: string | null) {
  const store = useMemo(() => liveNoteStore(id), [id])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
