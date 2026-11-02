// Thin fetch wrapper for the Django API: same-origin session cookies + CSRF.

import { t } from '../i18n/i18n'

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, data: unknown) {
    super(firstMessage(data) ?? t('errors.requestFailed', { status: String(status) }))
    this.status = status
    this.data = data
  }
}

/** `detail`, or the first field error DRF returned ({"file": ["Too large."]}). */
function firstMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  if ('detail' in data) return String((data as { detail: unknown }).detail)
  for (const value of Object.values(data)) {
    const message = Array.isArray(value) ? value[0] : value
    if (typeof message === 'string') return message
  }
  return undefined
}

function getCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split('=')[1]) : null
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * This tab, on every request: the server's change stream (live/changes)
 * marks what it changed with it, so this tab skips what it already shows.
 * Not crypto.randomUUID: it needs HTTPS, and the app may be on a LAN address.
 */
export const TAB_ID = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('')

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('X-BrainBro-Tab', TAB_ID)

  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (UNSAFE_METHODS.has(method)) {
    const token = getCookie('csrftoken')
    if (token) headers.set('X-CSRFToken', token)
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
  })

  if (response.status === 204) return undefined as T

  const data = response.headers.get('Content-Type')?.includes('application/json')
    ? await response.json()
    : null

  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

/**
 * POST a form with upload progress (0 to 1), which fetch can't report.
 * Rejects with ApiError, or with an AbortError when `signal` aborts.
 */
export function upload<T>(
  path: string,
  form: FormData,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', `/api${path}`)
    request.withCredentials = true
    request.setRequestHeader('Accept', 'application/json')
    request.setRequestHeader('X-BrainBro-Tab', TAB_ID)
    const token = getCookie('csrftoken')
    if (token) request.setRequestHeader('X-CSRFToken', token)

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    request.onload = () => {
      let data: unknown = null
      try {
        data = JSON.parse(request.responseText)
      } catch {
        // Not JSON (a proxy error page): keep the status only.
      }
      if (request.status >= 200 && request.status < 300) resolve(data as T)
      else reject(new ApiError(request.status, data))
    }
    request.onerror = () => reject(new Error(t('errors.network')))
    request.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(form)
  })
}
