import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { timeAgo } from '../lib/time'
import { useApiTokens, useCreateApiToken, useRevokeApiToken, type NewApiToken } from './api'

/** Personal API tokens: AI assistants (through MCP) and scripts use Brain as you. */
export function TokensPanel() {
  const { data: tokens } = useApiTokens()
  const create = useCreateApiToken()
  const revoke = useRevokeApiToken()
  const [name, setName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <div className="space-y-5">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        A token lets an AI assistant or a script read and add to your Brain as you. Connect
        assistants like Claude through MCP at <code>{mcpUrl()}</code>. Revoke a token and
        whatever uses it stops working.
      </p>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(name.trim(), { onSuccess: () => setName('') })
        }}
      >
        <input
          className="input"
          aria-label="Token name"
          placeholder="What it's for, like Claude Code"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="button-primary shrink-0"
          disabled={!name.trim() || create.isPending}
        >
          Create token
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}
      {create.data && <NewToken token={create.data} />}

      {tokens && tokens.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center gap-3 p-3">
              <div className="mr-auto min-w-0 text-sm">
                <div className="truncate font-medium">{token.name}</div>
                <div className="text-xs text-zinc-500">
                  <code>{token.prefix}…</code> · created {timeAgo(token.created_at)} ·{' '}
                  {token.last_used_at ? `last used ${timeAgo(token.last_used_at)}` : 'never used'}
                </div>
              </div>
              {confirming === token.id ? (
                <>
                  <button type="button" className="button-ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="button-ghost text-red-600 dark:text-red-400"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token.id, { onSuccess: () => setConfirming(null) })}
                  >
                    Revoke {token.name}
                  </button>
                </>
              ) : (
                <button type="button" className="button-ghost" onClick={() => setConfirming(token.id)}>
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {revoke.error.message}
        </p>
      )}
    </div>
  )
}

function mcpUrl() {
  return `${window.location.origin}/api/mcp/`
}

/** The token, shown this once, and how to connect Claude Code with it. */
function NewToken({ token }: { token: NewApiToken }) {
  const command = `claude mcp add --transport http brain ${mcpUrl()} --header "Authorization: Bearer ${token.token}"`
  return (
    <div className="space-y-3 rounded-xl border border-accent-300 bg-accent-50/50 p-3 dark:border-accent-800 dark:bg-accent-950/30">
      <p role="status" className="text-sm font-medium">
        Copy “{token.name}” now: it won't be shown again.
      </p>
      <CopyField label="Token" value={token.token} />
      <p className="text-sm text-zinc-600 dark:text-zinc-300">To use it from Claude Code:</p>
      <CopyField label="Claude Code command" value={command} />
    </div>
  )
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        className="input font-mono text-xs"
        aria-label={label}
        readOnly
        value={value}
        onFocus={(event) => event.target.select()}
      />
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        className="button-icon shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true))
        }}
      >
        {copied ? (
          <Check className="size-4 text-accent-600" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}
