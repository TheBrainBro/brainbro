import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeLiveServer } from '../test/liveServer'
import { LiveNote } from './live'

let server: FakeLiveServer
let open: LiveNote[]

function connect(id = 'n1') {
  const note = new LiveNote(id, { url: 'ws://localhost/api/live/notes', WebSocket: server.WebSocket })
  open.push(note)
  return note
}

async function until(condition: () => boolean) {
  await vi.waitFor(() => expect(condition()).toBe(true))
}

beforeEach(() => {
  server = new FakeLiveServer(() => 'Hello')
  open = []
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(() => {
  for (const note of open) note.destroy()
  vi.unstubAllGlobals()
})

describe('LiveNote', () => {
  it('gets the text from the server and goes live', async () => {
    const note = connect()
    expect(note.getSnapshot()).toMatchObject({ ready: false, status: 'connecting' })
    await until(() => note.getSnapshot().status === 'live')
    expect(note.getSnapshot().ready).toBe(true)
    expect(note.text.toString()).toBe('Hello')
  })

  it('merges two sessions typing at once', async () => {
    const laptop = connect()
    const phone = connect()
    await until(() => laptop.getSnapshot().status === 'live' && phone.getSnapshot().status === 'live')

    laptop.text.insert(5, ' world')
    phone.text.insert(0, 'Oh, ')
    await until(() => laptop.text.toString() === 'Oh, Hello world')
    await until(() => phone.text.toString() === 'Oh, Hello world')
    expect(server.text('n1')).toBe('Oh, Hello world')
  })

  it('sees the other sessions by name', async () => {
    const laptop = connect()
    const phone = connect()
    await until(() => laptop.getSnapshot().peers.length === 1)
    expect(laptop.getSnapshot().peers[0]).toMatchObject({ id: phone.doc.clientID, assistant: false })
  })

  it('sets its text changing only what differs, never splitting an emoji', async () => {
    const note = connect()
    await until(() => note.getSnapshot().ready)
    note.setText('Hello 😀 there')
    note.setText('Hello 😃 there')
    expect(note.text.toString()).toBe('Hello 😃 there')
    await until(() => server.text('n1') === 'Hello 😃 there')
  })

  it('undoes only its own edits', async () => {
    const mine = connect()
    const theirs = connect()
    await until(() => mine.getSnapshot().status === 'live' && theirs.getSnapshot().status === 'live')
    mine.text.insert(5, ', mine')
    theirs.text.insert(0, 'Theirs: ')
    await until(() => mine.text.toString() === 'Theirs: Hello, mine')

    mine.undoManager.undo()
    expect(mine.text.toString()).toBe('Theirs: Hello')
  })
})
