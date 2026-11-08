import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ApiToken } from './api'
import { TokensPanel } from './TokensPanel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const existing: ApiToken = {
  id: 't1',
  name: 'Script',
  prefix: 'brainbro_ab12',
  connected_app: false,
  permissions: ['read', 'capture', 'edit', 'publish'],
  created_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
}

function renderPanel(tokens: ApiToken[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const { name } = JSON.parse(String(init.body))
      return jsonResponse(
        { ...existing, id: 't2', name, prefix: 'brainbro_cd34', token: 'brainbro_cd34secret' },
        201,
      )
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (init?.method === 'PATCH') return jsonResponse(existing)
    return jsonResponse(url === '/api/auth/tokens/' ? tokens : [])
  })
  vi.stubGlobal('fetch', fetchMock)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <TokensPanel />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('TokensPanel', () => {
  it('gives the MCP URL and the Claude Code command to sign in with', () => {
    renderPanel([])

    expect(screen.getByRole('textbox', { name: 'MCP server URL' })).toHaveValue(
      `${window.location.origin}/api/mcp`,
    )
    expect(screen.getByRole('textbox', { name: 'Claude Code command' })).toHaveValue(
      `claude mcp add --transport http brainbro ${window.location.origin}/api/mcp`,
    )
  })

  it('copies a ready-to-paste prompt with this installation’s MCP URL without displaying it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderPanel([])

    expect(screen.queryByDisplayValue(/I use BrainBro/)).not.toBeInTheDocument()
    const title = screen.getByRole('heading', { name: 'Ready-to-paste prompt' })
    expect(title.parentElement).toHaveClass('flex', 'items-center', 'justify-between')

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))
    await screen.findByRole('status')
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`${window.location.origin}/api/mcp`),
    )
    expect(writeText.mock.calls[0][0]).toContain('list my inbox to check it works')
  })

  it('warns that a local address is no use to apps on the internet', () => {
    renderPanel([])
    expect(screen.getByText(/only works on this computer/)).toBeInTheDocument()
  })

  it('creates a token and shows it once, with the Claude Code command', async () => {
    renderPanel([])

    fireEvent.change(screen.getByRole('textbox', { name: 'Token name' }), {
      target: { value: 'Claude Code' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Copy “Claude Code” now: it won\'t be shown again.',
    )
    expect(screen.getByRole('textbox', { name: 'Token' })).toHaveValue('brainbro_cd34secret')
    expect(screen.getByRole('textbox', { name: 'Claude Code command with token' })).toHaveValue(
      `claude mcp add --transport http brainbro ${window.location.origin}/api/mcp --header "Authorization: Bearer brainbro_cd34secret"`,
    )
  })

  it('needs a name', () => {
    renderPanel([])
    expect(screen.getByRole('button', { name: 'Create token' })).toBeDisabled()
  })

  it('lists tokens and revokes one after confirming', async () => {
    const fetchMock = renderPanel([existing])

    expect(await screen.findByText('Script')).toBeInTheDocument()
    expect(screen.getByText(/never used/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke Script' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/tokens/t1/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })

  it('changes what a connected app may do', async () => {
    const fetchMock = renderPanel([{ ...existing, name: 'ChatGPT', connected_app: true }])

    fireEvent.click(await screen.findByRole('button', { name: 'Permissions' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^Publish/ }))

    await vi.waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
      expect(patch[0]).toBe('/api/auth/tokens/t1/')
      expect(JSON.parse(String(patch[1]!.body))).toEqual({
        permissions: ['read', 'capture', 'edit'],
      })
    })
  })

  it('has no permissions to change on a personal token', async () => {
    renderPanel([existing])

    await screen.findByRole('button', { name: 'Revoke' })
    expect(screen.queryByRole('button', { name: 'Permissions' })).not.toBeInTheDocument()
  })

  it('shows connected apps and disconnects them', async () => {
    const fetchMock = renderPanel([{ ...existing, name: 'ChatGPT', connected_app: true }])

    const list = await screen.findByRole('region', { name: 'Connected apps and tokens' })
    const row = within(list).getByText('ChatGPT').closest('li')!
    expect(row).toHaveTextContent(/Connected app · allowed .* · never used/)
    expect(row).not.toHaveTextContent('brainbro_ab12')

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect ChatGPT' }))

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/tokens/t1/',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    )
  })
})
