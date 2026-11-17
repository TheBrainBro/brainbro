import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TelegramStatus } from './api'
import { TelegramPanel } from './TelegramPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function statusOf(fields: Partial<TelegramStatus>): TelegramStatus {
  return {
    configured: true,
    bot_username: 'brainbro_bot',
    linked: false,
    telegram_name: '',
    linked_at: null,
    ...fields,
  }
}

function renderPanel(status: TelegramStatus, { isStaff = false } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse({ authenticated: true, user: { id: 1, username: 'alex', is_staff: isStaff } })
    }
    if (url === '/api/telegram/connect/') {
      return jsonResponse({ url: 'https://t.me/brainbro_bot?start=abc' })
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    return jsonResponse(status)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TelegramPanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('TelegramPanel', () => {
  it('makes a link that opens the bot', async () => {
    renderPanel(statusOf({}))

    fireEvent.click(await screen.findByRole('button', { name: 'Connect Telegram' }))

    const open = await screen.findByRole('link', { name: 'Open @brainbro_bot in Telegram' })
    expect(open).toHaveAttribute('href', 'https://t.me/brainbro_bot?start=abc')
    expect(screen.getByRole('status')).toHaveTextContent('Press Start there')
  })

  it('shows the connected chat and disconnects it', async () => {
    const fetchMock = renderPanel(statusOf({ linked: true, telegram_name: '@alex' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Connected as @alex to @brainbro_bot.',
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
    renderPanel(statusOf({ configured: false }))

    expect(
      await screen.findByText("The bot isn't set up on this server. Ask your admin to configure it."),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Telegram' })).not.toBeInTheDocument()
  })

  it('lets an admin set the bot up right there', async () => {
    renderPanel(statusOf({ configured: false }), { isStaff: true })

    expect(await screen.findByRole('heading', { name: 'Server bot' })).toBeInTheDocument()
    expect(screen.queryByText(/Ask your admin/)).not.toBeInTheDocument()
  })

  it('shows people without admin rights no bot settings', async () => {
    renderPanel(statusOf({}))

    expect(await screen.findByRole('button', { name: 'Connect Telegram' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Server bot' })).not.toBeInTheDocument()
  })
})
