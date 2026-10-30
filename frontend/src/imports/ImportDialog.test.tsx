import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VaultImport } from './api'
import { ImportDialog } from './ImportDialog'
import { summary } from './summary'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function importOf(fields: Partial<VaultImport>): VaultImport {
  return {
    id: 'i1',
    status: 'pending',
    filename: 'Vault.zip',
    counts: {},
    error: '',
    created_at: '2026-10-30T12:00:00Z',
    finished_at: null,
    ...fields,
  }
}

/** XMLHttpRequest double: each upload waits until the test answers it. */
class FakeXHR {
  static sent: FakeXHR[] = []
  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = {
    onprogress: null,
  }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  withCredentials = false
  status = 0
  responseText = ''
  url = ''
  body: FormData | null = null

  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  send(body: FormData) {
    this.body = body
    FakeXHR.sent.push(this)
  }
  abort() {}
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    act(() => this.onload?.())
  }
}

function renderDialog(latest: VaultImport | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ results: latest ? [latest] : [] })),
  )
  FakeXHR.sent = []
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ImportDialog onClose={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('ImportDialog', () => {
  it('uploads the chosen zip and says it is importing', async () => {
    renderDialog(null)

    await screen.findByRole('button', { name: 'Choose vault zip' })
    const zip = new File(['zip'], 'Vault.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByLabelText('Vault zip'), {
      target: { files: [zip] },
    })

    await waitFor(() => expect(FakeXHR.sent).toHaveLength(1))
    expect(screen.getByRole('status')).toHaveTextContent('Uploading… 0%')
    const [request] = FakeXHR.sent
    expect(request.url).toBe('/api/imports/')
    expect(request.body?.get('file')).toBe(zip)

    request.respond(202, importOf({}))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Importing Vault.zip'))
  })

  it('shows what the last import created, or why it failed', async () => {
    renderDialog(
      importOf({
        status: 'ready',
        counts: { notes: 3, collections: 1, skipped: 0 },
      }),
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 3 notes, 1 collection.')
    expect(screen.getByRole('button', { name: 'Import another vault' })).toBeInTheDocument()
  })

  it('shows the error of a failed import', async () => {
    renderDialog(importOf({ status: 'failed', error: "This isn't a zip file." }))

    expect(await screen.findByRole('alert')).toHaveTextContent("This isn't a zip file.")
  })

  it('shows why an upload was refused', async () => {
    renderDialog(null)

    await screen.findByRole('button', { name: 'Choose vault zip' })
    const zip = new File(['zip'], 'Vault.zip')
    fireEvent.change(screen.getByLabelText('Vault zip'), {
      target: { files: [zip] },
    })
    await waitFor(() => expect(FakeXHR.sent).toHaveLength(1))
    FakeXHR.sent[0].respond(409, { detail: 'An import is already running.' })

    expect(await screen.findByRole('alert')).toHaveTextContent('An import is already running.')
  })
})

describe('summary', () => {
  it('names what was created and what was skipped', () => {
    expect(summary({ notes: 1, images: 2, boards: 0, skipped: 1 })).toBe(
      'Imported 1 note, 2 images. 1 file was skipped (too large or unreadable).',
    )
    expect(summary({})).toBe('Nothing to import was found.')
  })
})
