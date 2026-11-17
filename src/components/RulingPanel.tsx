import { useState } from 'react'
import { useWriteContract } from 'wagmi'
import { Gavel, Hourglass } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime, formatDuration, shortAddress, usdcWithCommas } from '@/lib/format'
import type { EscrowView, RulingDecisionView } from '@/lib/types'
import { CHAIN_STATE } from '@/hooks/useEscrowChain'
import { useNow } from '@/hooks/useNow'
import { ChainAction } from './ChainAction'

interface Props {
  view: EscrowView
  /** Live contract state enum. */
  state: number
  onChanged: () => void
}

/** What each side receives from a ruling, mirroring the contract's split. */
export function rulingSplit(view: Pick<EscrowView, 'price' | 'buyerDeposit' | 'sellerDeposit'>, d: Pick<RulingDecisionView, 'buyerPriceRefund' | 'fault' | 'penalty'>) {
  const price = BigInt(view.price)
  const refund = BigInt(d.buyerPriceRefund)
  const penalty = BigInt(d.penalty)
  return {
    buyer: refund + BigInt(view.buyerDeposit) - (d.fault === 1 ? penalty : 0n),
    seller: price - refund + BigInt(view.sellerDeposit) - (d.fault === 2 ? penalty : 0n),
    penalty,
  }
}

export function DecisionSummary({ view, decision, reason }: { view: Pick<EscrowView, 'price' | 'buyerDeposit' | 'sellerDeposit'>; decision: RulingDecisionView; reason: string | undefined }) {
  const { tr } = useLang()
  const split = rulingSplit(view, decision)
  const faultLabel = decision.fault === 1 ? 'Buyer' : decision.fault === 2 ? 'Seller' : tr('Không bên nào', 'Neither side')
  return (
    <div className="space-y-2">
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="inner p-3"><dt className="label">Buyer {tr('nhận', 'receives')}</dt><dd className="display text-xl font-bold tabular-nums">{usdcWithCommas(split.buyer)} <span className="text-xs font-medium text-[var(--subtle)]">USDC</span></dd></div>
        <div className="inner p-3"><dt className="label">Seller {tr('nhận', 'receives')}</dt><dd className="display text-xl font-bold tabular-nums">{usdcWithCommas(split.seller)} <span className="text-xs font-medium text-[var(--subtle)]">USDC</span></dd></div>
        <div className="inner p-3"><dt className="label">{tr('Phạt', 'Penalty')}</dt><dd className="display text-xl font-bold tabular-nums">{usdcWithCommas(split.penalty)} <span className="text-xs font-medium text-[var(--subtle)]">USDC</span></dd></div>
      </dl>
      <p className="text-xs text-[var(--muted)]">
        {tr('Bên có lỗi', 'At fault')}: <strong>{faultLabel}</strong>. {tr('Người phán quyết', 'Ruled by')} <span className="mono">{shortAddress(decision.by)}</span>.
      </p>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-2)]">
        {reason ?? <span className="mono text-xs text-[var(--subtle)]">{tr('Lý do (chỉ có mã băm):', 'Reason (hash only):')} {decision.reasonHash}</span>}
      </p>
    </div>
  )
}

/** The path out of a lock: Arbiter ruling, one 72 hour appeal, then a final ruling. */
export function RulingPanel({ view, state, onChanged }: Props) {
  const { tr, lang } = useLang()
  const { writeContractAsync } = useWriteContract()
  const now = useNow()
  const [reason, setReason] = useState('')
  const id = BigInt(view.onChainId)
  const ruling = view.ruling
  const prelim = ruling?.prelim ?? null
  const record = (action: string) => (hash: `0x${string}`) => api(`/transactions/${view.publicId}/tx`, { body: { txHash: hash, action } }).catch(() => undefined)

  if (state === CHAIN_STATE.Overdue || state === CHAIN_STATE.Disputed) {
    return (
      <section className="card space-y-2 p-5">
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Hourglass className="size-4" /> {tr('Chờ Admin phán quyết', 'Waiting for the Arbiter')}</h2>
        <p className="text-sm text-[var(--ink-2)]">
          {tr(
            'Tiền đang khóa. Hãy gửi bằng chứng ở bên dưới để Arbiter xem xét. Hai bên cũng có thể tự thỏa thuận bằng chữ ký chung bất cứ lúc nào.',
            'Funds are locked. Add evidence below for the Arbiter to review. You can also settle by mutual agreement at any time.',
          )}
        </p>
      </section>
    )
  }

  if (state === CHAIN_STATE.PreliminaryRuling && prelim) {
    const remaining = prelim.appealDeadline - now
    const open = remaining >= 0
    return (
      <section className="card space-y-4 p-5">
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Gavel className="size-4" /> {tr('Phán quyết sơ bộ', 'Preliminary ruling')}</h2>
        <DecisionSummary view={view} decision={prelim} reason={ruling?.notes[prelim.reasonHash]} />
        {open ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]">
              {tr(
                `Còn ${formatDuration(remaining, lang)} để kháng cáo (đến ${formatDateTime(prelim.appealDeadline, lang)}). Chỉ được kháng cáo một lần. Người xét kháng cáo có thể giữ, giảm hoặc tăng mức phạt.`,
                `${formatDuration(remaining, lang)} left to appeal (until ${formatDateTime(prelim.appealDeadline, lang)}). Only one appeal is allowed. The reviewer may keep, lower or raise the penalty.`,
              )}
            </p>
            <textarea className="field min-h-24" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Lý do kháng cáo (Admin sẽ đọc được)', 'Reason for the appeal (the Admin can read it)')} />
            <ChainAction
              label={tr('Kháng cáo phán quyết', 'Appeal this ruling')}
              variant="danger"
              disabled={reason.trim().length < 10}
              send={async () => {
                const note = await api<{ hash: `0x${string}` }>(`/transactions/${view.publicId}/notes`, { body: { text: reason.trim() } })
                return writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'appeal', args: [id, note.hash], chainId: CHAIN_ID })
              }}
              onSubmitted={record('appeal')}
              onDone={onChanged}
            />
            <p className="text-xs text-[var(--muted)]">{tr('Nếu không ai kháng cáo, phán quyết trở thành cuối cùng sau thời hạn này.', 'If nobody appeals, the ruling becomes final when this window ends.')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-[var(--ink-2)]">{tr('Hết thời hạn kháng cáo. Ai cũng có thể chốt phán quyết; sau đó mỗi bên tự claim phần của mình.', 'The appeal window has ended. Anyone can finalize the ruling; each side then claims its own share.')}</p>
            <ChainAction
              label={tr('Chốt phán quyết', 'Finalize ruling')}
              send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'finalizeRuling', args: [id], chainId: CHAIN_ID })}
              onSubmitted={record('finalizeRuling')}
              onDone={onChanged}
            />
          </div>
        )}
      </section>
    )
  }

  if (state === CHAIN_STATE.Appealed && prelim) {
    return (
      <section className="card space-y-4 p-5">
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Hourglass className="size-4" /> {tr('Đang chờ xét kháng cáo', 'Appeal under review')}</h2>
        <p className="text-sm text-[var(--ink-2)]">
          {tr('Một Appeal Reviewer khác với Arbiter sẽ ra phán quyết cuối cùng. Không thể kháng cáo thêm.', 'An Appeal Reviewer, different from the Arbiter, will issue the final ruling. No further appeal is possible.')}
        </p>
        {ruling?.appeal && <p className="whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-muted)] p-3 text-sm">{ruling.notes[ruling.appeal.reasonHash] ?? ruling.appeal.reasonHash}</p>}
        <div className="text-xs font-semibold text-[var(--muted)]">{tr('Phán quyết sơ bộ đang bị kháng cáo', 'Preliminary ruling under appeal')}</div>
        <DecisionSummary view={view} decision={prelim} reason={ruling?.notes[prelim.reasonHash]} />
      </section>
    )
  }

  if (state === CHAIN_STATE.Finalized && ruling?.final) {
    return (
      <section className="card space-y-4 p-5">
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Gavel className="size-4" /> {ruling.final.byAppeal ? tr('Phán quyết cuối cùng (sau kháng cáo)', 'Final ruling (after appeal)') : tr('Phán quyết cuối cùng', 'Final ruling')}</h2>
        <DecisionSummary view={view} decision={ruling.final} reason={ruling.notes[ruling.final.reasonHash]} />
      </section>
    )
  }
  return null
}
