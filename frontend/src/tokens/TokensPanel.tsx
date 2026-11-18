import { Bot, Check, ChevronDown, Copy, KeyRound, Plus, Terminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useSession } from '../auth/session'
import { rich, t, useT } from '../i18n/i18n'
import { localReach, useAppOrigin } from '../lib/address'
import { copyText } from '../lib/dom'
import { timeAgo } from '../lib/time'
import { Notice } from '../settings/Notice'
import { SettingsSection } from '../settings/SettingsSection'
import { CopyField } from '../ui/CopyField'
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
  useUpdateTokenPermissions,
  type ApiToken,
  type NewApiToken,
} from './api'
import { AppLogo } from './AppLogo'
import { PermissionChoices } from './PermissionChoices'

/**
 * AI assistants (through MCP) and scripts: how to connect each one, and the
 * apps and personal tokens that can use BrainBro as you.
 */
export function TokensPanel() {
  useT()
  const url = useMcpUrl()
  const reach = localReach(new URL(url).hostname)
  const { data: session } = useSession()
  const admin = !!session?.user?.is_staff
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      <SettingsSection title={t('tokens.connect')} description={t('tokens.intro')}>
        <CopyField label={t('tokens.mcpUrl')} value={url} />
        {reach && (
          // Only admins have the page where the public address is set.
          <Notice page={admin ? 'general' : undefined}>
            {t(reach === 'computer' ? 'tokens.localOnly' : 'tokens.networkOnly')}
            {!admin && ` ${t('tokens.askAdmin')}`}
          </Notice>
        )}
        <div className="space-y-2">
          <h5 className="text-sm font-medium">{t('tokens.stepByStep')}</h5>
          <Setups />
        </div>
        <Prompt />
      </SettingsSection>
      <SettingsSection title={t('tokens.access')} description={t('tokens.accessIntro')}>
        <Connections />
        <NewTokenForm />
      </SettingsSection>
    </div>
  )
}

/** The MCP server's address, on the public address when there is one. */
function useMcpUrl() {
  return `${useAppOrigin()}/api/mcp`
}

/** A message to paste in the assistant, tailored to this installation: it guides the connection itself. */
function Prompt() {
  const url = useMcpUrl()
  const prompt = t('tokens.prompt', { url })
  const [copied, setCopied] = useState(false)
  return (
    <section
      aria-labelledby="assistant-prompt-title"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="mr-auto min-w-0 flex-1 basis-56">
        <h5 id="assistant-prompt-title" className="text-sm font-medium">
          {t('tokens.guideTitle')}
        </h5>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('tokens.guideIntro')}</p>
      </div>
      <button
        type="button"
        className="button-outline shrink-0 px-3 py-1.5"
        onClick={() => {
          void copyText(prompt).then(() => setCopied(true))
        }}
      >
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
        {copied ? t('tokens.promptCopied') : t('tokens.copyPrompt')}
      </button>
      {copied && (
        <span role="status" className="sr-only">
          {t('tokens.promptCopied')}
        </span>
      )}
    </section>
  )
}

function Setups() {
  const url = useMcpUrl()
  return (
    <div
      data-tutorial="assistant-setup"
      className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
    >
      <Setup title="Claude" logo="claude" detail={t('tokens.claudeDetail')}>
        <li>{rich('tokens.claudeStep1', { b: bold })}</li>
        <li>{rich('tokens.claudeStep2', { b: bold })}</li>
        <li>{rich('tokens.claudeStep3', { b: bold })}</li>
      </Setup>
      <Setup title="ChatGPT" logo="chatgpt" detail={t('tokens.chatgptDetail')}>
        <li>
          {rich('tokens.chatgptStep1', {
            b: bold,
            link: <ExternalLink href="https://chatgpt.com/plugins">chatgpt.com/plugins</ExternalLink>,
          })}
        </li>
        <li>{t('tokens.chatgptStep2')}</li>
        <li>{t('tokens.chatgptStep3')}</li>
      </Setup>
      <Setup title="Grok" logo="grok">
        <li>
          {rich('tokens.grokStep1', {
            b: bold,
            link: <ExternalLink href="https://grok.com/connectors">grok.com/connectors</ExternalLink>,
          })}
        </li>
        <li>{t('tokens.grokStep2')}</li>
        <li>{t('tokens.grokStep3')}</li>
      </Setup>
      <Setup title="Claude Code" logo="terminal">
        <li>
          {t('tokens.claudeCodeStep1')}
          <div className="mt-1.5">
            <CopyField
              label={t('tokens.claudeCodeCommand')}
              value={`claude mcp add --transport http brainbro ${url}`}
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

function Setup({
  title,
  logo,
  detail,
  children,
}: {
  title: string
  logo: string
  detail?: string
  children: ReactNode
}) {
  return (
    <details className="group p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {logo === 'terminal' ? (
          <Terminal className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
        ) : (
          <span aria-hidden="true">
            <AppLogo logo={logo} className="size-4 shrink-0" />
          </span>
        )}
        {title}
        {detail && <span className="font-normal text-zinc-500">{detail}</span>}
        <ChevronDown className="ml-auto size-4 shrink-0 text-zinc-400 transition group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ol className="mt-3 ml-6.5 list-decimal space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
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
  const [editing, setEditing] = useState<string | null>(null)
  if (!tokens) return null
  if (!tokens.length) return <p className="text-sm text-zinc-500">{t('tokens.noAccess')}</p>

  return (
    <div className="space-y-2">
      <ul
        aria-label={t('tokens.connections')}
        className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tokens.map((token) => (
          <li key={token.id} className="space-y-3 p-3">
            <div className="flex items-center gap-3">
              {token.connected_app ? (
                <Bot className="size-4 shrink-0 text-accent-500" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
              )}
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
                    className="button-danger-ghost"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token.id, { onSuccess: () => setConfirming(null) })}
                  >
                    {t(token.connected_app ? 'tokens.disconnectNamed' : 'tokens.revokeNamed', {
                      name: token.name,
                    })}
                  </button>
                </>
              ) : (
                <>
                  {token.connected_app && (
                    <button
                      type="button"
                      className="button-ghost"
                      aria-expanded={editing === token.id}
                      onClick={() => setEditing(editing === token.id ? null : token.id)}
                    >
                      {t('tokens.permissions')}
                    </button>
                  )}
                  <button type="button" className="button-danger-ghost" onClick={() => setConfirming(token.id)}>
                    {token.connected_app ? t('tokens.disconnect') : t('tokens.revoke')}
                  </button>
                </>
              )}
            </div>
            {editing === token.id && <AppPermissions token={token} />}
          </li>
        ))}
      </ul>
      {revoke.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {revoke.error.message}
        </p>
      )}
    </div>
  )
}

/** What a connected app may do, saved on every change. */
function AppPermissions({ token }: { token: ApiToken }) {
  useT()
  const update = useUpdateTokenPermissions(token.id)
  return (
    <div className="space-y-2">
      <PermissionChoices
        value={token.permissions}
        onChange={(permissions) => update.mutate(permissions)}
        disabled={update.isPending}
      />
      <p className="text-xs text-zinc-500">{t('tokens.permissionsChanged')}</p>
      {update.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {update.error.message}
        </p>
      )}
    </div>
  )
}

/**
 * A personal token, for scripts and tools that send it as a header: a card
 * that opens into the form, and stays open to show the token once made.
 */
function NewTokenForm() {
  useT()
  const create = useCreateApiToken()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)

  function close() {
    setOpen(false)
    setName('')
    create.reset()
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 p-4 text-sm font-medium text-zinc-600 transition hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-accent-500 dark:hover:text-accent-300"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t('tokens.newToken')}
      </button>
    )
  }

  return (
    <section
      aria-labelledby="new-token-title"
      className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div>
        <h5 id="new-token-title" className="text-sm font-semibold">
          {t('tokens.newToken')}
        </h5>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('tokens.personalIntro')}</p>
      </div>
      {create.data ? (
        <NewToken token={create.data} />
      ) : (
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
          <button type="submit" className="button-primary shrink-0" disabled={!name.trim() || create.isPending}>
            {t('tokens.create')}
          </button>
        </form>
      )}
      {create.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}
      <div className="flex justify-end">
        <button type="button" className="button-secondary" onClick={close}>
          {create.data ? t('tokens.done') : t('common.cancel')}
        </button>
      </div>
    </section>
  )
}

/** The token, shown this once, and how to connect Claude Code with it. */
function NewToken({ token }: { token: NewApiToken }) {
  useT()
  const url = useMcpUrl()
  const command = `claude mcp add --transport http brainbro ${url} --header "Authorization: Bearer ${token.token}"`
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
