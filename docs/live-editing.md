# Live note editing

A note open in several places at once (a laptop, a phone, a board card, an
assistant's edit) is one shared document: everyone's edits merge on their
own, each session sees the others' cursors with a name and color, and no one
ever has to pick a version.

## How it works

Edits travel as small operations instead of the whole text, and merge as a
CRDT ([Yjs](https://yjs.dev)):

- **Browser** (`frontend/src/notes/live.ts`): a `Y.Doc` per open note, bound to
  the CodeMirror editor (`y-codemirror.next`), synced over a WebSocket
  (`y-websocket`) and kept on the device in IndexedDB (`y-indexeddb`), so edits
  made offline merge when it reconnects. Undo (Cmd+Z) undoes this session's
  edits only.
- **Server** (`backend/apps/collab`): `GET /api/live/notes/<id>` upgrades to a
  WebSocket, served by uvicorn next to Django (`config/asgi.py` sends
  WebSockets to `apps.collab.asgi`). It needs the session cookie, sent from
  this site, for one of the user's own notes. That is checked again every
  minute while it stays open: signing out, a changed password or a disabled
  account close it, and the editor stops editing. Each `api` process keeps one
  document per open note in memory (`rooms.py`, with `pycrdt`), and the
  processes keep each other up to date through Redis pub/sub, one channel per
  note (`relay.py`).
- **Database**: the document is stored in `NoteDocument`, beside the note, so
  edits made apart (offline, or while the note was closed) still merge. The
  merged Markdown is written to `Item.body` a few seconds after it changes
  and when the last session leaves, so search, embeddings, the graph, exports
  and MCP read the note as before.

Only the server builds a document from Markdown, once per note: two documents
built apart from the same text would merge into it twice. Whatever writes the
body outside the document (an assistant's `edit_note`, the REST API from an
older app still cached on a device) calls `documents.body_written`, which
merges the change in as an edit and sends it to open sessions; an assistant's
edit shows its name and cursor on what it wrote. Anything else that writes the
body is noticed the next time the document is opened or saved.

## Names

For now one person has several sessions, so each shows as its device and
browser ("Chrome on Mac"), with a color picked once per device. Assistants
show their name.

## Not yet

- Boards: the same approach (a shared map for the layout), in its own issue.
- Sharing notes between accounts: access is checked per note on connect
  (`asgi.can_open`), today the owner only.
