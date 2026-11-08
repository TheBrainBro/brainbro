import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CaptureProvider } from '../capture/CaptureProvider'
import type { CaptureDestination } from '../capture/context'
import { TutorialContext, type Tutorial } from '../onboarding/tutorial'
import { FeedbackProvider } from '../ui/FeedbackProvider'
import { CaptureBox } from './CaptureBox'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/items/capture/' && init?.method === 'POST') {
      return jsonResponse({ id: 'captured', kind: 'note', collections: [] }, 201)
    }
    return jsonResponse({ count: 0, next: null, previous: null, results: [] })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderBox(into?: CaptureDestination) {
  const complete = vi.fn()
  const tutorial = { step: 'capture', complete } as unknown as Tutorial
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FeedbackProvider>
        <CaptureProvider>
          <TutorialContext value={tutorial}>
            <CaptureBox into={into} />
          </TutorialContext>
        </CaptureProvider>
      </FeedbackProvider>
    </QueryClientProvider>,
  )
  const box = screen.getByLabelText('Capture')
  fireEvent.change(box, { target: { value: 'Call the client' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  return { box, complete }
}

describe('CaptureBox', () => {
  it('moves the tutorial on when it captures into the inbox', async () => {
    const { box, complete } = renderBox()
    await waitFor(() => expect(box).toHaveValue(''))
    expect(complete).toHaveBeenCalledWith('capture')
  })

  it('leaves the tutorial alone when it captures into a collection', async () => {
    const { box, complete } = renderBox({ id: 'work', name: 'Work' })
    await waitFor(() => expect(box).toHaveValue(''))
    expect(complete).not.toHaveBeenCalled()
  })
})
