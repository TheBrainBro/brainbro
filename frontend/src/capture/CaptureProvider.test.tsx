import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Item } from '../items/api'
import { InboxPage } from '../pages/InboxPage'
import { CaptureProvider } from './CaptureProvider'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeItem(overrides: Partial<Item>): Item {
  return {
    id: crypto.randomUUID(),
    kind: 'note',
    status: 'inbox',
    title: '',
    body: '',
    url: '',
    metadata: {},
    preview_status: '',
    preview_image_url: null,
    file_url: null,
    collections: [],
    version: 'v1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

/** XMLHttpRequest double: each upload waits until the test answers it. */
class FakeXHR {
  static sent: FakeXHR[] = []
  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  withCredentials = false
  status = 0
  responseText = ''
  url = ''
  body: FormData | null = null
  aborted = false

  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  send(body: FormData) {
    this.body = body
    FakeXHR.sent.push(this)
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  get file() {
    return this.body?.get('file') as File
  }
  progress(loaded: number, total: number) {
    act(() => this.upload.onprogress?.({ lengthComputable: true, loaded, total }))
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}

let items: Item[]
let fetchMock: ReturnType<typeof vi.fn>

function setUp({ limit }: { limit?: number } = {}) {
  items = []
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse({
        authenticated: true,
        user: { id: 1, username: 'carlos', email: '', is_staff: true },
        ...(limit ? { limits: { upload_max_size: limit } } : {}),
      })
    }
    if (url === '/api/items/capture/') {
      const item = makeItem({ body: JSON.parse(String(init?.body)).text })
      items = [item, ...items]
      return jsonResponse(item, 201)
    }
    if (url === '/api/items/triage/') {
      const { ids } = JSON.parse(String(init?.body))
      items = items.filter((item) => !ids.includes(item.id))
      return jsonResponse({ deleted: ids.length })
    }
    return jsonResponse({ count: items.length, next: null, previous: null, results: items })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
}

/** Answer an upload the way the server would, adding the item to the list. */
function serverCreates(xhr: FakeXHR, overrides: Partial<Item>) {
  const item = makeItem(overrides)
  items = [item, ...items]
  xhr.respond(201, item)
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CaptureProvider>
          <InboxPage />
        </CaptureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function dataTransfer(files: File[], folders: string[] = []) {
  const entries = [
    ...files.map((file) => ({ file, isDirectory: false })),
    ...folders.map((name) => ({ file: new File([], name), isDirectory: true })),
  ]
  return {
    types: ['Files'],
    files,
    items: entries.map(({ file, isDirectory }) => ({
      kind: 'file',
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory }),
    })),
    getData: () => '',
    dropEffect: 'none',
  }
}

function dispatchDrag(type: string, transfer: object, target: EventTarget = document.body) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function drop(transfer: object) {
  dispatchDrag('dragenter', transfer)
  return dispatchDrag('drop', transfer)
}

beforeEach(() => {
  FakeXHR.sent = []
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:local', revokeObjectURL: () => {} }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const png = () => new File(['a'.repeat(20)], 'shot.png', { type: 'image/png' })
const pdf = () => new File(['b'.repeat(30)], 'Invoice.pdf', { type: 'application/pdf' })

describe('CaptureProvider', () => {
  it('shows a full-window overlay while dragging files and hides it on leave or Esc', async () => {
    setUp()
    renderApp()
    await screen.findByText(/Inbox zero/)
    const transfer = dataTransfer([pdf()])

    dispatchDrag('dragenter', transfer)
    expect(screen.getByText('Drop to capture')).toBeInTheDocument()
    dispatchDrag('dragleave', transfer)
    expect(screen.queryByText('Drop to capture')).toBeNull()

    dispatchDrag('dragenter', transfer)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText('Drop to capture')).toBeNull()
    // Dropping after Esc captures nothing, but the browser still doesn't open the file.
    expect(dispatchDrag('drop', transfer).defaultPrevented).toBe(true)
    expect(FakeXHR.sent).toHaveLength(0)
  })

  it('ignores plain text drags and drags that start inside the app', async () => {
    setUp()
    renderApp()
    await screen.findByText(/Inbox zero/)

    dispatchDrag('dragenter', { types: ['text/plain'], getData: () => 'x' })
    expect(screen.queryByText('Drop to capture')).toBeNull()

    dispatchDrag('dragstart', {})
    dispatchDrag('dragenter', { types: ['text/uri-list'], getData: () => 'https://a.io' })
    expect(screen.queryByText('Drop to capture')).toBeNull()
  })

  it('never lets the browser open a file dropped outside the overlay', async () => {
    setUp()
    renderApp()
    await screen.findByText(/Inbox zero/)
    const transfer = dataTransfer([pdf()])
    expect(dispatchDrag('dragover', transfer).defaultPrevented).toBe(true)
  })

  it('uploads one item per file with progress, and keeps errors per file', async () => {
    setUp()
    renderApp()
    await screen.findByText(/Inbox zero/)

    const event = drop(dataTransfer([png(), pdf()], ['Photos']))
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByText('Drop to capture')).toBeNull()

    // Optimistic cards right away, the folder already refused.
    const capturing = await screen.findByRole('list', { name: 'Capturing' })
    expect(within(capturing).getAllByRole('progressbar')).toHaveLength(2)
    expect(within(capturing).getByText(/Folders aren't supported/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Capturing 3 items…')

    await waitFor(() => expect(FakeXHR.sent).toHaveLength(2))
    const [imageUpload, pdfUpload] = FakeXHR.sent
    expect(imageUpload.url).toBe('/api/items/capture/')
    expect(imageUpload.file.name).toBe('shot.png')
    expect(pdfUpload.file.name).toBe('Invoice.pdf')

    imageUpload.progress(5, 10)
    expect(screen.getByRole('progressbar', { name: 'Uploading shot.png' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )

    await act(async () =>
      serverCreates(imageUpload, {
        kind: 'image',
        metadata: { filename: 'shot.png', width: 2, height: 1 },
        preview_status: 'ready',
        preview_image_url: '/api/items/x/preview-image/?v=1.webp',
        file_url: '/api/items/x/file/?v=1.png',
      }),
    )
    await act(async () => pdfUpload.respond(400, { file: ['Upload rejected.'] }))

    // The image is a server item now; the PDF failed on its own.
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    const failed = screen.getByRole('article', { name: 'Failed: Invoice.pdf' })
    expect(within(failed).getByRole('alert')).toHaveTextContent('Upload rejected.')
    expect(screen.getByRole('status')).toHaveTextContent('Captured 1 of 3')
    expect(screen.getByRole('status')).toHaveTextContent('Invoice.pdf: Upload rejected.')

    // A failed upload can be retried; a folder can only be dismissed.
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(FakeXHR.sent).toHaveLength(3))
    await act(async () =>
      serverCreates(FakeXHR.sent[2], {
        kind: 'file',
        title: 'Invoice.pdf',
        metadata: { filename: 'Invoice.pdf', size: 30, mime: 'application/pdf' },
        file_url: '/api/items/y/file/?v=1.pdf',
      }),
    )
    expect(await screen.findByRole('link', { name: 'Invoice.pdf' })).toBeInTheDocument()
    const folder = screen.getByRole('article', { name: 'Failed: Photos' })
    expect(within(folder).queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(within(folder).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('list', { name: 'Capturing' })).toBeNull()
  })

  it('refuses files over the server limit before uploading them', async () => {
    setUp({ limit: 25 })
    renderApp()
    await screen.findByText(/Inbox zero/)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/session/', expect.anything()),
    )

    drop(dataTransfer([png(), pdf()]))

    const failed = await screen.findByRole('article', { name: 'Failed: Invoice.pdf' })
    expect(failed).toHaveTextContent('The file is too large (max 25 B).')
    expect(screen.getByRole('status')).toHaveTextContent('Capturing 2 items…')
    await waitFor(() => expect(FakeXHR.sent).toHaveLength(1))
    expect(FakeXHR.sent[0].file.name).toBe('shot.png')

    drop(dataTransfer([pdf()]))
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't capture 1 item")
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('undoes a paste: aborts uploads in flight and deletes what was created', async () => {
    setUp()
    renderApp()
    await screen.findByText(/Inbox zero/)

    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: dataTransfer([png(), pdf()]) })
    act(() => {
      document.body.dispatchEvent(paste)
    })
    expect(paste.defaultPrevented).toBe(true)

    await waitFor(() => expect(FakeXHR.sent).toHaveLength(2))
    const created = makeItem({ kind: 'image', metadata: { filename: 'shot.png' } })
    items = [created]
    await act(async () => FakeXHR.sent[0].respond(201, created))
    await waitFor(() => expect(screen.getAllByRole('progressbar')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(FakeXHR.sent[1].aborted).toBe(true)
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/items/triage/',
        expect.objectContaining({ body: JSON.stringify({ ids: [created.id], action: 'delete' }) }),
      ),
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(await screen.findByText(/Inbox zero/)).toBeInTheDocument()
  })

  it('lets text fields keep text pastes but captures pasted files', async () => {
    setUp()
    renderApp()
    const box = await screen.findByLabelText('Capture')

    const textPaste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(textPaste, 'clipboardData', {
      value: { types: ['text/plain'], getData: () => 'typed' },
    })
    box.dispatchEvent(textPaste)
    expect(textPaste.defaultPrevented).toBe(false)

    // An editor that handled the paste and re-rendered the node it landed on.
    const detached = document.createElement('div')
    const handledPaste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(handledPaste, 'clipboardData', {
      value: { types: ['text/plain'], getData: () => '# pasted into a note' },
    })
    Object.defineProperty(handledPaste, 'target', { value: detached })
    handledPaste.preventDefault()
    act(() => {
      window.dispatchEvent(handledPaste)
    })
    const captures = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/items/capture/').length
    expect(captures()).toBe(0)

    const filePaste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(filePaste, 'clipboardData', { value: dataTransfer([png()]) })
    act(() => {
      box.dispatchEvent(filePaste)
    })
    expect(filePaste.defaultPrevented).toBe(true)
    await waitFor(() => expect(FakeXHR.sent).toHaveLength(1))
  })
})
