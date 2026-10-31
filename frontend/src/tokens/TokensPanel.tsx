import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { timeAgo } from '../lib/time'
import { useApiTokens, useCreateApiToken, useRevokeApiToken, type NewApiToken } from './api'

/**
 * AI assistants (through MCP) and scripts: how to connect each one, and the
 * apps and personal tokens that can use Brain as you.
 */
export function TokensPanel() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Let an AI assistant search, read and add to your Brain. Add Brain to it with this
        address, then sign in here and allow it. It can't delete anything.
      </p>
      <div className="space-y-2">
        <CopyField label="MCP server URL" value={mcpUrl()} />
        {isLocal() && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            This address only works on this computer. Claude, ChatGPT and Grok connect from
            the internet: use Brain's public address.
          </p>
        )}
      </div>
      <Setups />
      <Connections />
      <NewTokenForm />
    </div>
  )
}

/** The MCP server's canonical URI, as OAuth metadata names it. */
function mcpUrl() {
  return `${window.location.origin}/api/mcp`
}

function isLocal() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

function Setups() {
  return (
    <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <Setup title="Claude" detail="Web, desktop and mobile">
        <li>
          In Claude, open <b>Customize → Connectors</b> and choose <b>Add custom connector</b>.
        </li>
        <li>
          Paste the URL and press <b>Add</b>.
        </li>
        <li>
          Press <b>Connect</b>, then allow it here in Brain.
        </li>
      </Setup>
      <Setup title="ChatGPT" detail="Depends on your ChatGPT plan">
        <li>
          Open <ExternalLink href="https://chatgpt.com/plugins">chatgpt.com/plugins</ExternalLink>,
          press <b>+</b> and choose <b>Add custom MCP server</b>.
        </li>
        <li>Give it a name, paste the URL, accept the warning and create it.</li>
        <li>When ChatGPT asks you to sign in, allow it here in Brain.</li>
      </Setup>
      <Setup title="Grok">
        <li>
          Open <ExternalLink href="https://grok.com/connectors">grok.com/connectors</ExternalLink>
          , choose <b>New Connector</b> and then <b>Custom</b>.
        </li>
        <li>Paste the URL.</li>
        <li>Sign in to Brain when asked and allow it.</li>
      </Setup>
      <Setup title="Claude Code">
        <li>
          Run this in a terminal:
          <div className="mt-1.5">
            <CopyField
              label="Claude Code command"
              value={`claude mcp add --transport http brain ${mcpUrl()}`}
            />
          </div>
        </li>
        <li>
          In Claude Code, run <code>/mcp</code>, choose <b>brain</b> and sign in. Or use a
          personal token below instead.
        </li>
      </Setup>
    </div>
  )
}

function Setup({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <details className="group p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {title}
        {detail && <span className="ml-2 font-normal text-zinc-500">{detail}</span>}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
        {children}
      </ol>
    </details>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent-600 hover:underline dark:text-accent-400">
      {children}
    </a>
  )
}

/** Connected apps and personal tokens, each revoked the same way. */
function Connections() {
  const { data: tokens } = useApiTokens()
  const revoke = useRevokeApiToken()
  const [confirming, setConfirming] = useState<string | null>(null)
  if (!tokens?.length) return null

  return (
    <section aria-labelledby="connections-title" className="space-y-2">
      <h4 id="connections-title" className="text-sm font-medium">
        Connected apps and tokens
      </h4>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tokens.map((token) => (
          <li key={token.id} className="flex items-center gap-3 p-3">
            <div className="mr-auto min-w-0 text-sm">
              <div className="truncate font-medium">{token.name}</div>
              <div className="text-xs text-zinc-500">
                {token.connected_app ? 'Connected app' : <code>{token.prefix}…</code>} ·{' '}
                {token.connected_app ? 'allowed' : 'created'} {timeAgo(token.created_at)} ·{' '}
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
                  {token.connected_app ? 'Disconnect' : 'Revoke'} {token.name}
                </button>
              </>
            ) : (
              <button type="button" className="button-ghost" onClick={() => setConfirming(token.id)}>
                {token.connected_app ? 'Disconnect' : 'Revoke'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {revoke.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {revoke.error.message}
        </p>
      )}
    </section>
  )
}

/** A personal token: for scripts, and tools that send it as a header. */
function NewTokenForm() {
  const create = useCreateApiToken()
  const [name, setName] = useState('')

  return (
    <section aria-labelledby="new-token-title" className="space-y-2">
      <h4 id="new-token-title" className="text-sm font-medium">
        Personal tokens
      </h4>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        For scripts and tools that send a token instead of signing in. It works until you revoke
        it.
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
          placeholder="What it's for, like a backup script"
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
    </section>
  )
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
      <CopyField label="Claude Code command with token" value={command} />
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
