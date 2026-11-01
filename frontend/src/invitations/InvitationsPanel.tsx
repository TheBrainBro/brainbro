import { useState } from 'react'

import { t, useT } from '../i18n/i18n'
import { timeAgo } from '../lib/time'
import { CopyField } from '../ui/CopyField'
import { type Invitation, useCreateInvitation, useInvitations, useRevokeInvitation } from './api'

/**
 * Admins invite people with a link: whoever opens it makes their own
 * account, with a Brain of their own that nobody else can see.
 */
export function InvitationsPanel() {
  useT()
  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {t('invitations.intro')}
      </p>
      <NewInvitationForm />
      <Invitations />
    </div>
  )
}

function NewInvitationForm() {
  useT()
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
          aria-label={t('invitations.whoFor')}
          placeholder={t('invitations.whoForOptional')}
          maxLength={100}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className="button-primary shrink-0" disabled={create.isPending}>
          {t('invitations.create')}
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
            {t('invitations.sendNow')}
          </p>
          <CopyField label={t('invitations.link')} value={create.data.url} />
        </div>
      )}
    </section>
  )
}

function Invitations() {
  useT()
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
            {t('invitations.pending')}
          </h4>
          <InvitationList invitations={pending} revoke={revoke} />
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="invitations-done" className="space-y-2">
          <h4 id="invitations-done" className="text-sm font-medium text-zinc-500">
            {t('invitations.done')}
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
  useT()
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {invitations.map((invitation) => {
        const name = invitation.note || t('invitations.invitation')
        // Pending links are revoked; expired ones are only taken off the list.
        const action = ({ pending: 'revoke', expired: 'remove', accepted: null } as const)[
          invitation.status
        ]
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
                    {t('invitations.keep')}
                  </button>
                  <button
                    type="button"
                    className="button-ghost text-red-600 dark:text-red-400"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(invitation.id, { onSuccess: () => setConfirming(null) })
                    }
                  >
                    {t(action === 'revoke' ? 'invitations.revokeNamed' : 'invitations.removeNamed', {
                      name,
                    })}
                  </button>
                </>
              ) : (
                <button type="button" className="button-ghost" onClick={() => setConfirming(invitation.id)}>
                  {t(`invitations.${action}`)}
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
      return t('invitations.pendingStatus', {
        created: timeAgo(invitation.created_at),
        expires: timeAgo(invitation.expires_at),
      })
    case 'accepted': {
      const when = timeAgo(invitation.used_at ?? invitation.expires_at)
      return invitation.used_by
        ? t('invitations.acceptedBy', { name: invitation.used_by, when })
        : t('invitations.accepted', { when })
    }
    case 'expired':
      return t('invitations.expired', { when: timeAgo(invitation.expires_at) })
  }
}
