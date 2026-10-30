import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TelegramStatus } from './api'
import { TelegramDialog } from './TelegramDialog'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function statusOf(fields: Partial<TelegramStatus>): TelegramStatus {
  return {
    configured: true,
    bot_username: 'brain_bot',
    linked: false,
    telegram_name: '',
    linked_at: null,
    ...fields,
  }
}

function renderDialog(status: TelegramStatus) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/telegram/connect/') {
      return jsonResponse({ url: 'https://t.me/brain_bot?start=abc' })
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return jsonResponse(status)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TelegramDialog onClose={() => {}} />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('TelegramDialog', () => {
  it('makes a link that opens the bot', async () => {
    renderDialog(statusOf({}))

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }))

    const open = await screen.findByRole('link', { name: 'Open @brain_bot in Telegram' })
    expect(open).toHaveAttribute('href', 'https://t.me/brain_bot?start=abc')
    expect(screen.getByRole('status')).toHaveTextContent('Press Start there')
  })

  it('shows the connected chat and disconnects it', async () => {
    const fetchMock = renderDialog(statusOf({ linked: true, telegram_name: '@carlos' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Connected as @carlos to @brain_bot.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/telegram/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('says when the server has no bot', async () => {
    renderDialog(statusOf({ configured: false }))

    expect(await screen.findByText(/isn't set up on this server/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument()
  })
})
