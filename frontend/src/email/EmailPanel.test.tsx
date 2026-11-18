import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EmailSettings } from './api'
import { EmailPanel } from './EmailPanel'
import { FeedbackProvider } from '../ui/FeedbackProvider'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const off: EmailSettings = {
  source: 'environment',
  enabled: false,
  provider: '',
  from_email: '',
  default_from: '',
  mailgun_domain: '',
  mailgun_region: 'us',
  has_api_key: false,
  environment_enabled: false,
}

const saved: EmailSettings = {
  ...off,
  source: 'database',
  enabled: true,
  provider: 'mailgun',
  default_from: 'BrainBro <noreply@mail.example.com>',
  mailgun_domain: 'mail.example.com',
  has_api_key: true,
}

function renderPanel(
  settings: EmailSettings,
  { email = 'admin@example.com', saveResult = null as Response | null, testResult = null as Response | null } = {},
) {
  let current = settings
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session/') {
      return jsonResponse({
        authenticated: true,
        user: { id: 1, username: 'admin', email, is_staff: true },
        email_enabled: current.enabled,
      })
    }
    if (url === '/api/server/email/test/') {
      return testResult?.clone() ?? jsonResponse({ sent_to: email, provider: 'Mailgun' })
    }
    if (url === '/api/server/email/') {
      if (init?.method === 'PUT') {
        if (saveResult) return saveResult.clone()
        const body = JSON.parse(String(init.body))
        current = { ...saved, ...body, mailgun_api_key: undefined }
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
      <FeedbackProvider>
        <EmailPanel />
      </FeedbackProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('EmailPanel', () => {
  it('sets up Mailgun', async () => {
    const fetchMock = renderPanel(off)

    expect(await screen.findByText('Email is off')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'mailgun' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'key-123' } })
    fireEvent.change(screen.getByLabelText('Sending domain'), { target: { value: 'mail.example.com' } })
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'eu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Email is on, with the settings saved here')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/server/email/',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          provider: 'mailgun',
          from_email: '',
          mailgun_domain: 'mail.example.com',
          mailgun_region: 'eu',
          mailgun_api_key: 'key-123',
        }),
      }),
    )
  })

  it('never shows a saved key, only that there is one', async () => {
    renderPanel(saved)

    const key = await screen.findByLabelText('API key')
    expect(key).toHaveValue('')
    expect(key).toHaveAttribute('placeholder', 'Saved. Type a new one to replace it.')
  })

  it('says why the settings were refused', async () => {
    renderPanel(off, {
      saveResult: jsonResponse({ mailgun_domain: ['Enter the domain Mailgun sends from.'] }, 400),
    })

    fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'mailgun' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the domain Mailgun sends from.')
  })

  it('goes back to the environment variables', async () => {
    const fetchMock = renderPanel({ ...saved, environment_enabled: true })

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('goes back to the email set up in the server’s environment variables')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Email is off')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/server/email/', expect.objectContaining({ method: 'DELETE' }))
  })

  it('warns that removing the settings turns email off without environment variables', async () => {
    renderPanel(saved)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Email turns off')
  })

  it('sends a test email to the admin', async () => {
    renderPanel(saved)

    expect(await screen.findByText('It goes to your email, admin@example.com.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))

    expect(await screen.findByText(/Handed to Mailgun for admin@example.com/)).toBeInTheDocument()
  })

  it('says why the test failed', async () => {
    renderPanel(saved, {
      testResult: jsonResponse({ detail: "The email couldn't be sent: Forbidden" }, 400),
    })

    await screen.findByText('It goes to your email, admin@example.com.')
    fireEvent.click(screen.getByRole('button', { name: 'Send a test email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
  })

  it('needs the admin’s email and email on to test', async () => {
    renderPanel(off, { email: '' })

    expect(await screen.findByText('Add your email in Profile to send yourself a test.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send a test email' })).toBeDisabled()
  })
})
