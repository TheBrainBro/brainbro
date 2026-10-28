/**
 * Shares waiting to be captured, in IndexedDB. The service worker puts what
 * the share sheet sends; the app takes it into the capture pipeline and
 * deletes it once the server has it, so nothing shared offline or signed out
 * is lost. Used from both the app and the service worker, so only APIs the
 * two share.
 */

export type Share = {
  id: string
  /** Epoch ms, so the queue drains in the order things were shared. */
  createdAt: number
  title: string
  text: string
  url: string
  files: File[]
}

const DB_NAME = 'brain'
const STORE = 'shares'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = use(transaction.objectStore(STORE))
      // Resolve on commit, not on the request: a put isn't durable before.
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export function saveShare(share: Share) {
  return withStore('readwrite', (store) => store.put(share)).then(() => undefined)
}

export async function listShares() {
  const shares = await withStore<Share[]>('readonly', (store) => store.getAll())
  return shares.sort((a, b) => a.createdAt - b.createdAt)
}

export function deleteShare(id: string) {
  return withStore('readwrite', (store) => store.delete(id)).then(() => undefined)
}
