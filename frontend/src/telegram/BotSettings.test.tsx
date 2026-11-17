import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TelegramSettings } from './api'
import { BotSettings } from './BotSettings'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const HOOK = 'https://brain.example.com/api/telegram/webhook/'

const off: TelegramSettings = {
  source: 'environment',
  configured: false,
  bot_username: '',
  webhook_url: HOOK,
  environment_configured: false,
}

const saved: TelegramSettings = {
  ...off,
  source: 'database',
  configured: true,
  bot_username: 'brainbro_bot',
}

function renderPanel(settings: TelegramSettings, { saveResult = null as Response | null } = {}) {
  let current = settings
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/server/telegram/') {
      if (init?.method === 'PUT') {
        if (saveResult) return saveResult.clone()
        current = saved
        return jsonResponse(current)
      }
      if (init?.method === 'DELETE') {
        current = off
        return jsonResponse(current)
      }
      return jsonResponse(current)
    }
    return jsonResponse({ detail: 'Not found.' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <BotSettings />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('BotSettings', () => {
  it('saves the token from BotFather', async () => {
    const fetchMock = renderPanel(off)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Bot token'), { target: { value: ' 123:abc ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Using @brainbro_bot, saved here')).toBeInTheDocument()
    expect(screen.getByText(`Telegram delivers its messages to ${HOOK}`)).toBeInTheDocument()
    expect(screen.getByLabelText('Bot token')).toHaveValue('')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/server/telegram/',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ bot_token: '123:abc' }) }),
    )
  })

  it('says why a token was refused', async () => {
    renderPanel(off, {
      saveResult: jsonResponse({ bot_token: ["Telegram didn't accept this token."] }, 400),
    })

    fireEvent.change(await screen.findByLabelText('Bot token'), { target: { value: '999:wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Telegram didn't accept this token.")
  })

  it('warns when Telegram has nowhere to deliver', async () => {
    renderPanel({ ...saved, webhook_url: '' })

    expect(await screen.findByRole('alert')).toHaveTextContent('it needs an HTTPS public address')
  })

  it('removes the saved bot', async () => {
    const fetchMock = renderPanel(saved)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByPlaceholderText('123456789:AA...')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/server/telegram/', expect.objectContaining({ method: 'DELETE' }))
  })
})
