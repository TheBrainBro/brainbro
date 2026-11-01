import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

type Room = { doc: Y.Doc; awareness: awarenessProtocol.Awareness; sockets: Set<FakeLiveSocket> }

/**
 * A stand-in for the server's live notes (backend apps.collab), in memory.
 * A note's document is built from `bodyOf` the first time it is opened, as
 * the server builds it from the note's body. Install it with
 * `vi.stubGlobal('WebSocket', server.WebSocket)`.
 */
export class FakeLiveServer {
  rooms = new Map<string, Room>()
  /** While down, connections fail and nothing reaches the server. */
  down = false
  bodyOf: (id: string) => string

  constructor(bodyOf: (id: string) => string = () => '') {
    this.bodyOf = bodyOf
  }

  get WebSocket() {
    // `new` on it opens a socket to this server.
    return FakeLiveSocket.bind(null, this) as unknown as typeof WebSocket
  }

  room(id: string) {
    let room = this.rooms.get(id)
    if (!room) {
      const doc = new Y.Doc()
      doc.getText('body').insert(0, this.bodyOf(id))
      const awareness = new awarenessProtocol.Awareness(doc)
      awareness.setLocalState(null)
      room = { doc, awareness, sockets: new Set() }
      const opened = room
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        opened.sockets.forEach((socket) => socket !== origin && socket.deliver(encoder))
      })
      awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        const clients = [...added, ...updated, ...removed]
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, clients))
        opened.sockets.forEach((socket) => socket !== origin && socket.deliver(encoder))
      })
      this.rooms.set(id, room)
    }
    return room
  }

  text(id: string) {
    return this.room(id).doc.getText('body').toString()
  }

  /** An edit made on the server (an assistant's), with who made it present in the note. */
  edit(id: string, change: (text: Y.Text) => void, by?: { name: string; color: string }) {
    const room = this.room(id)
    room.doc.transact(() => change(room.doc.getText('body')))
    if (by) room.awareness.setLocalState({ user: by, assistant: true })
  }

  /** The connection drops: sessions go offline until `up`. */
  drop() {
    this.down = true
    for (const room of this.rooms.values()) room.sockets.forEach((socket) => socket.close())
  }

  up() {
    this.down = false
  }
}

class FakeLiveSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  CONNECTING = 0
  OPEN = 1
  CLOSING = 2
  CLOSED = 3
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  private server: FakeLiveServer
  private room: Room | null = null
  private id: string

  constructor(server: FakeLiveServer, url: string) {
    this.server = server
    this.id = new URL(url).pathname.split('/').pop()!
    setTimeout(() => this.connect())
  }

  private connect() {
    if (this.readyState !== this.CONNECTING) return
    if (this.server.down) {
      this.readyState = this.CLOSED
      this.onerror?.({})
      this.onclose?.({ code: 1006, reason: '' })
      return
    }
    this.room = this.server.room(this.id)
    this.room.sockets.add(this)
    this.readyState = this.OPEN
    this.onopen?.({})
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.room.doc)
    this.deliver(encoder)
    const states = [...this.room.awareness.getStates().keys()]
    if (states.length) {
      const awareness = encoding.createEncoder()
      encoding.writeVarUint(awareness, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        awareness,
        awarenessProtocol.encodeAwarenessUpdate(this.room.awareness, states),
      )
      this.deliver(awareness)
    }
  }

  deliver(encoder: encoding.Encoder) {
    const data = encoding.toUint8Array(encoder)
    setTimeout(() => {
      if (this.readyState === this.OPEN) this.onmessage?.({ data: data.slice().buffer })
    })
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (this.readyState !== this.OPEN || !this.room) return
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.readSyncMessage(decoder, encoder, this.room.doc, this)
      if (encoding.length(encoder) > 1) this.deliver(encoder)
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.room.awareness, decoding.readVarUint8Array(decoder), this)
    }
  }

  close() {
    if (this.readyState === this.CLOSED) return
    this.readyState = this.CLOSED
    this.room?.sockets.delete(this)
    setTimeout(() => this.onclose?.({ code: 1000, reason: '' }))
  }
}
