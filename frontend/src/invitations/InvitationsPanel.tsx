import { useState } from 'react'

import { timeAgo } from '../lib/time'
import { CopyField } from '../ui/CopyField'
import { type Invitation, useCreateInvitation, useInvitations, useRevokeInvitation } from './api'

/**
 * Admins invite people with a link: whoever opens it makes their own
 * account, with a Brain of their own that nobody else can see.
 */
export function InvitationsPanel() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Invite someone to have their own Brain on this server. They open the link and pick a
        username and password. Each link works once and expires after 7 days. Nobody can see
        anyone else's things.
      </p>
      <NewInvitationForm />
      <Invitations />
    </div>
  )
}

function NewInvitationForm() {
  const create = useCreateInvitation()
  const [note, setNote] = useState('')

  return (
    <section className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(note.trim(), { onSuccess: () => setNote('') })
        }}
      >
        <input
          className="input"
          aria-label="Who it's for"
          placeholder="Who it's for (optional)"
          maxLength={100}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className="button-primary shrink-0" disabled={create.isPending}>
          Create link
        </button>
      </form>
      {create.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {create.error.message}
        </p>
      )}
      {create.data && (
        <div className="space-y-3 rounded-xl border border-accent-300 bg-accent-50/50 p-3 dark:border-accent-800 dark:bg-accent-950/30">
          <p role="status" className="text-sm font-medium">
            Send this link now: it won't be shown again.
          </p>
          <CopyField label="Invitation link" value={create.data.url} />
        </div>
      )}
    </section>
  )
}

function Invitations() {
  const { data: invitations } = useInvitations()
  const revoke = useRevokeInvitation()
  if (!invitations?.length) return null
  const pending = invitations.filter((invitation) => invitation.status === 'pending')
  const done = invitations.filter((invitation) => invitation.status !== 'pending')

  return (
    <>
      {pending.length > 0 && (
        <section aria-labelledby="invitations-pending" className="space-y-2">
          <h4 id="invitations-pending" className="text-sm font-medium">
            Waiting to be used
          </h4>
          <InvitationList invitations={pending} revoke={revoke} />
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="invitations-done" className="space-y-2">
          <h4 id="invitations-done" className="text-sm font-medium text-zinc-500">
            Accepted or expired
          </h4>
          <InvitationList invitations={done} revoke={revoke} />
        </section>
      )}
      {revoke.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {revoke.error.message}
        </p>
      )}
    </>
  )
}

function InvitationList({
  invitations,
  revoke,
}: {
  invitations: Invitation[]
  revoke: ReturnType<typeof useRevokeInvitation>
}) {
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {invitations.map((invitation) => {
        const name = invitation.note || 'Invitation'
        // Pending links are revoked; expired ones are only taken off the list.
        const action = { pending: 'Revoke', expired: 'Remove', accepted: null }[invitation.status]
        return (
          <li
            key={invitation.id}
            className={`flex items-center gap-3 p-3 ${invitation.status === 'pending' ? '' : 'text-zinc-500'}`}
          >
            <div className="mr-auto min-w-0 text-sm">
              <div className={`truncate ${invitation.status === 'pending' ? 'font-medium' : ''}`}>
                {name}
              </div>
              <div className="text-xs text-zinc-500">{describe(invitation)}</div>
            </div>
            {action &&
              (confirming === invitation.id ? (
                <>
                  <button type="button" className="button-ghost" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="button-ghost text-red-600 dark:text-red-400"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(invitation.id, { onSuccess: () => setConfirming(null) })
                    }
                  >
                    {action} {name}
                  </button>
                </>
              ) : (
                <button type="button" className="button-ghost" onClick={() => setConfirming(invitation.id)}>
                  {action}
                </button>
              ))}
          </li>
        )
      })}
    </ul>
  )
}

function describe(invitation: Invitation) {
  switch (invitation.status) {
    case 'pending':
      return `created ${timeAgo(invitation.created_at)} · expires ${timeAgo(invitation.expires_at)}`
    case 'accepted': {
      const by = invitation.used_by ? ` by ${invitation.used_by}` : ''
      return `accepted${by} ${timeAgo(invitation.used_at ?? invitation.expires_at)}`
    }
    case 'expired':
      return `expired ${timeAgo(invitation.expires_at)}`
  }
}
