import { useState } from 'react'
import { useWriteContract } from 'wagmi'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { usdc, usdcWithCommas } from '@/lib/format'
import { parseUsdc } from '@/onchain-money'
import type { AdminCase } from '@/lib/types'
import { ChainAction } from './ChainAction'
import { rulingSplit } from './RulingPanel'

interface Props {
  view: AdminCase
  /** 'prelim' is the Arbiter's appealable ruling; 'final' is the Appeal Reviewer's last word. */
  kind: 'prelim' | 'final'
  onDone: () => void
}

/** Ruling form: price split, optional penalty on the at-fault side, written reasons. Sent from the admin's own wallet. */
export function RulingForm({ view, kind, onDone }: Props) {
  const { tr } = useLang()
  const { writeContractAsync } = useWriteContract()
  const [refund, setRefund] = useState('0')
  const [fault, setFault] = useState<0 | 1 | 2>(0)
  const [penalty, setPenalty] = useState('0')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const price = BigInt(view.price)
  const faultDeposit = fault === 1 ? BigInt(view.buyerDeposit) : fault === 2 ? BigInt(view.sellerDeposit) : 0n
  let refundUnits: bigint | null = null
  let penaltyUnits: bigint | null = null
  try {
    refundUnits = parseUsdc(refund.trim() === '' ? '0' : refund)
    penaltyUnits = fault === 0 ? 0n : parseUsdc(penalty.trim() === '' ? '0' : penalty)
  } catch {
    refundUnits = null
    penaltyUnits = null
  }
  const refundOk = refundUnits !== null && refundUnits >= 0n && refundUnits <= price
  const penaltyOk = penaltyUnits !== null && penaltyUnits >= 0n && penaltyUnits <= faultDeposit
  const valid = refundOk && penaltyOk && reason.trim().length >= 10 && confirmed && !view.isParty
  const preview = refundOk && penaltyOk && refundUnits !== null && penaltyUnits !== null
    ? rulingSplit(view, { buyerPriceRefund: refundUnits.toString(), fault, penalty: penaltyUnits.toString() })
    : null

  return (
    <section className="card space-y-4 p-5">
      <h2 className="display text-lg font-semibold">{kind === 'prelim' ? tr('Ra phán quyết sơ bộ', 'Issue a preliminary ruling') : tr('Ra phán quyết cuối cùng', 'Issue the final ruling')}</h2>
      {view.isParty && <p className="rounded-xl bg-[#fde8ec] p-3 text-sm text-[var(--danger)]" role="alert">{tr('Ví này là một bên của giao dịch nên hợp đồng sẽ từ chối phán quyết.', 'This wallet is a party of the deal, so the contract will reject the ruling.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="label">{tr(`Hoàn lại cho Buyer từ giá (0 đến ${usdc(price)} USDC)`, `Refund to Buyer from the price (0 to ${usdc(price)} USDC)`)}</span>
          <input className="field" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} />
          {!refundOk && <span className="text-xs text-[var(--danger)]">{tr('Số tiền không hợp lệ.', 'Invalid amount.')}</span>}
        </label>
        <label className="space-y-1 text-sm">
          <span className="label">{tr('Bên có lỗi', 'At-fault side')}</span>
          <select className="field" value={fault} onChange={(e) => { setFault(Number(e.target.value) as 0 | 1 | 2); setPenalty('0') }}>
            <option value={0}>{tr('Không bên nào (không phạt)', 'Neither (no penalty)')}</option>
            <option value={1}>Buyer</option>
            <option value={2}>Seller</option>
          </select>
        </label>
        {fault !== 0 && (
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="label">{tr(`Mức phạt (tối đa ${usdc(faultDeposit)} USDC, tức 100% cọc của bên đó)`, `Penalty (up to ${usdc(faultDeposit)} USDC, 100% of that side's deposit)`)}</span>
            <div className="flex gap-2">
              <input className="field" inputMode="decimal" value={penalty} onChange={(e) => setPenalty(e.target.value)} />
              <button type="button" className="btn btn-ghost !px-3 text-xs" onClick={() => setPenalty(usdc(faultDeposit))}>100%</button>
            </div>
            {!penaltyOk && <span className="text-xs text-[var(--danger)]">{tr('Mức phạt vượt quá cọc hoặc không hợp lệ.', 'The penalty exceeds the deposit or is invalid.')}</span>}
          </label>
        )}
      </div>
      {preview && (
        <p className="inner p-3 text-sm">
          {tr('Kết quả', 'Result')}: Buyer <strong className="tabular-nums">{usdcWithCommas(preview.buyer)}</strong>, Seller <strong className="tabular-nums">{usdcWithCommas(preview.seller)}</strong>, {tr('ví phạt', 'penalty wallet')} <strong className="tabular-nums">{usdcWithCommas(preview.penalty)}</strong> USDC
        </p>
      )}
      <textarea className="field min-h-28" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Lý do phán quyết dựa trên bằng chứng (hai bên sẽ đọc được)', 'Reasoning based on the evidence (both parties can read it)')} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{kind === 'prelim' ? tr('Tôi hiểu phán quyết được ghi lên chuỗi và sẽ có hiệu lực nếu không ai kháng cáo trong 72 giờ.', 'I understand this is recorded onchain and takes effect unless someone appeals within 72 hours.') : tr('Tôi hiểu phán quyết này là cuối cùng và không thể đổi.', 'I understand this ruling is final and cannot be changed.')}</span>
      </label>
      <ChainAction
        label={kind === 'prelim' ? tr('Ghi phán quyết sơ bộ lên chuỗi', 'Record preliminary ruling onchain') : tr('Ghi phán quyết cuối cùng lên chuỗi', 'Record final ruling onchain')}
        disabled={!valid}
        send={async () => {
          const note = await api<{ hash: `0x${string}` }>(`/admin/cases/${view.publicId}?action=notes`, { body: { text: reason.trim() } })
          return writeContractAsync({
            address: ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: kind === 'prelim' ? 'issuePreliminaryRuling' : 'issueFinalRuling',
            args: [BigInt(view.onChainId), refundUnits ?? 0n, fault, penaltyUnits ?? 0n, note.hash],
            chainId: CHAIN_ID,
          })
        }}
        onDone={onDone}
      />
    </section>
  )
}
