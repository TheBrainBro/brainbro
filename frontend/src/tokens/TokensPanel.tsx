import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { rich, t, useT } from '../i18n/i18n'
import { timeAgo } from '../lib/time'
import { CopyField } from '../ui/CopyField'
import { useApiTokens, useCreateApiToken, useRevokeApiToken, type NewApiToken } from './api'

/**
 * AI assistants (through MCP) and scripts: how to connect each one, and the
 * apps and personal tokens that can use BrainBro as you.
 */
export function TokensPanel() {
  useT()
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {t('tokens.intro')}
      </p>
      <div className="space-y-2">
        <CopyField label={t('tokens.mcpUrl')} value={mcpUrl()} />
        {isLocal() && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t('tokens.localOnly')}
          </p>
        )}
      </div>
      <Prompt />
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

/** A ready-to-paste prompt tailored to this BrainBro installation. */
function Prompt() {
  const url = mcpUrl()
  const prompt = t('tokens.prompt', { url })
  const [copied, setCopied] = useState(false)
  return (
    <section aria-labelledby="assistant-prompt-title" className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 id="assistant-prompt-title" className="text-sm font-medium">
          {t('tokens.promptTitle')}
        </h4>
        <button
          type="button"
          className="button-ghost inline-flex items-center gap-2"
          onClick={() => {
            void navigator.clipboard.writeText(prompt).then(() => setCopied(true))
          }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? t('tokens.promptCopied') : t('tokens.copyPrompt')}
        </button>
      </div>
      {copied && (
        <span role="status" className="sr-only">
          {t('tokens.promptCopied')}
        </span>
      )}
    </section>
  )
}

function Setups() {
  return (
    <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <Setup title="Claude" detail={t('tokens.claudeDetail')}>
        <li>{rich('tokens.claudeStep1', { b: bold })}</li>
        <li>{rich('tokens.claudeStep2', { b: bold })}</li>
        <li>{rich('tokens.claudeStep3', { b: bold })}</li>
      </Setup>
      <Setup title="ChatGPT" detail={t('tokens.chatgptDetail')}>
        <li>
          {rich('tokens.chatgptStep1', {
            b: bold,
            link: <ExternalLink href="https://chatgpt.com/plugins">chatgpt.com/plugins</ExternalLink>,
          })}
        </li>
        <li>{t('tokens.chatgptStep2')}</li>
        <li>{t('tokens.chatgptStep3')}</li>
      </Setup>
      <Setup title="Grok">
        <li>
          {rich('tokens.grokStep1', {
            b: bold,
            link: <ExternalLink href="https://grok.com/connectors">grok.com/connectors</ExternalLink>,
          })}
        </li>
        <li>{t('tokens.grokStep2')}</li>
        <li>{t('tokens.grokStep3')}</li>
      </Setup>
      <Setup title="Claude Code">
        <li>
          {t('tokens.claudeCodeStep1')}
          <div className="mt-1.5">
            <CopyField
              label={t('tokens.claudeCodeCommand')}
              value={`claude mcp add --transport http brainbro ${mcpUrl()}`}
            />
          </div>
        </li>
        <li>
          {rich('tokens.claudeCodeStep2', { b: bold, code: (chunk) => <code>{chunk}</code> })}
        </li>
      </Setup>
    </div>
  )
}

function bold(chunk: string) {
  return <b>{chunk}</b>
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
  useT()
  const { data: tokens } = useApiTokens()
  const revoke = useRevokeApiToken()
  const [confirming, setConfirming] = useState<string | null>(null)
  if (!tokens?.length) return null

  return (
    <section aria-labelledby="connections-title" className="space-y-2">
      <h4 id="connections-title" className="text-sm font-medium">
        {t('tokens.connections')}
      </h4>
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tokens.map((token) => (
          <li key={token.id} className="flex items-center gap-3 p-3">
            <div className="mr-auto min-w-0 text-sm">
              <div className="truncate font-medium">{token.name}</div>
              <div className="text-xs text-zinc-500">
                {token.connected_app ? t('tokens.connectedApp') : <code>{token.prefix}…</code>} ·{' '}
                {t(token.connected_app ? 'tokens.allowed' : 'tokens.created', {
                  when: timeAgo(token.created_at),
                })}{' '}
                ·{' '}
                {token.last_used_at
                  ? t('tokens.lastUsed', { when: timeAgo(token.last_used_at) })
                  : t('tokens.neverUsed')}
              </div>
            </div>
            {confirming === token.id ? (
              <>
                <button type="button" className="button-ghost" onClick={() => setConfirming(null)}>
                  {t('tokens.keep')}
                </button>
                <button
                  type="button"
                  className="button-ghost text-red-600 dark:text-red-400"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(token.id, { onSuccess: () => setConfirming(null) })}
                >
                  {t(token.connected_app ? 'tokens.disconnectNamed' : 'tokens.revokeNamed', {
                    name: token.name,
                  })}
                </button>
              </>
            ) : (
              <button type="button" className="button-ghost" onClick={() => setConfirming(token.id)}>
                {token.connected_app ? t('tokens.disconnect') : t('tokens.revoke')}
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
  useT()
  const create = useCreateApiToken()
  const [name, setName] = useState('')

  return (
    <section aria-labelledby="new-token-title" className="space-y-2">
      <h4 id="new-token-title" className="text-sm font-medium">
        {t('tokens.personal')}
      </h4>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {t('tokens.personalIntro')}
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
          aria-label={t('tokens.tokenName')}
          placeholder={t('tokens.tokenPlaceholder')}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="submit"
          className="button-primary shrink-0"
          disabled={!name.trim() || create.isPending}
        >
          {t('tokens.create')}
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
  useT()
  const command = `claude mcp add --transport http brainbro ${mcpUrl()} --header "Authorization: Bearer ${token.token}"`
  return (
    <div className="space-y-3 rounded-xl border border-accent-300 bg-accent-50/50 p-3 dark:border-accent-800 dark:bg-accent-950/30">
      <p role="status" className="text-sm font-medium">
        {t('tokens.copyNow', { name: token.name })}
      </p>
      <CopyField label={t('tokens.token')} value={token.token} />
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{t('tokens.useFromClaudeCode')}</p>
      <CopyField label={t('tokens.commandWithToken')} value={command} />
    </div>
  )
}
