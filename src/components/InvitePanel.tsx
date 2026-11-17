import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Send } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { DraftView } from '@/lib/types'
import { InviteShare } from './InviteShare'

interface Issued {
  invitationId: string
  token: string
  code: string
  expiresAt: number
}

/** Creator-only: issue, re-issue or revoke the single invitation for an unclaimed draft. */
export function InvitePanel({ draft }: { draft: DraftView }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inv = draft.invitation
  const active = Boolean(inv && !inv.revoked && !inv.claimed && !inv.expired)

  async function issue() {
    setBusy(true)
    setError(null)
    try {
      setIssued(await api<Issued>(`/drafts/${draft.id}/invitations`, { body: {} }))
      await qc.invalidateQueries({ queryKey: ['draft', draft.id] })
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    if (!inv) return
    setBusy(true)
    setError(null)
    try {
      await api(`/invitations/${inv.id}?action=revoke`, { body: {} })
      setIssued(null)
      await qc.invalidateQueries({ queryKey: ['draft', draft.id] })
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="display text-lg font-semibold">{tr('Mời đối tác', 'Invite your counterparty')}</h2>
        <p className="text-sm text-[var(--muted)]">
          {tr(
            'Một lời mời, ba cách chia sẻ: liên kết, mã hoặc QR. Hết hạn sau 24 giờ và chỉ một tài khoản nhận được.',
            'One invitation, three ways to share: link, code or QR. It expires after 24 hours and only one account can claim it.',
          )}
        </p>
      </div>
      {issued && active ? (
        <InviteShare token={issued.token} code={issued.code} expiresAt={issued.expiresAt} />
      ) : (
        inv && (
          <p className="text-sm text-[var(--ink-2)]">
            {active
              ? tr(`Đã có lời mời đang hiệu lực đến ${formatDateTime(inv.expiresAt, lang)}. Vì mã và liên kết chỉ hiển thị một lần, hãy tạo lại nếu bạn cần xem lại.`, `An invitation is active until ${formatDateTime(inv.expiresAt, lang)}. Code and link are shown only once, so re-issue if you need them again.`)
              : inv.revoked
                ? tr('Lời mời đã bị thu hồi.', 'The invitation was revoked.')
                : tr('Lời mời đã hết hạn.', 'The invitation expired.')}
          </p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={() => void issue()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {inv ? tr('Tạo lại lời mời', 'Re-issue invitation') : tr('Tạo lời mời', 'Create invitation')}
        </button>
        {active && (
          <button type="button" className="btn btn-danger" onClick={() => void revoke()} disabled={busy}>
            {tr('Thu hồi', 'Revoke')}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
    </section>
  )
}
