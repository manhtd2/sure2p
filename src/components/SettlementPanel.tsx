import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSignTypedData, useWriteContract } from 'wagmi'
import { CheckCircle2, CircleDashed, Handshake, Loader2 } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime, usdc, usdcWithCommas } from '@/lib/format'
import { parseUsdc } from '@/onchain-money'
import type { EscrowView, SettlementProposalView } from '@/lib/types'
import { eip712Domain, settlementFromJson, settlementTypes } from '@/shared/protocol'
import { parseTxError } from '@/hooks/useTx'
import { ChainAction } from './ChainAction'

interface Props {
  view: EscrowView
  onChanged: () => void
}

/**
 * Dual-signed mutual settlement: Buyer price refund 0..price, both deposits always refunded
 * in full, no penalty. Neither side can change the split alone.
 */
export function SettlementPanel({ view, onChanged }: Props) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const [refund, setRefund] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const price = BigInt(view.price)
  const buyerDeposit = BigInt(view.buyerDeposit)
  const sellerDeposit = BigInt(view.sellerDeposit)
  const key = ['settlement', view.publicId]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<{ proposal: SettlementProposalView | null }>(`/transactions/${view.publicId}/settlements`),
    refetchInterval: 4000,
  })
  const proposal = data?.proposal ?? null

  let refundUnits: bigint | null = null
  try {
    refundUnits = refund.trim() === '' ? null : parseUsdc(refund)
  } catch {
    refundUnits = null
  }
  const refundValid = refundUnits !== null && refundUnits >= 0n && refundUnits <= price

  async function propose() {
    if (refundUnits === null || !refundValid) return
    setBusy(true)
    setError(null)
    try {
      await api(`/transactions/${view.publicId}/settlements`, { body: { buyerPriceRefund: refundUnits.toString() } })
      setRefund('')
      await qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function sign(p: SettlementProposalView) {
    setBusy(true)
    setError(null)
    try {
      const signature = await signTypedDataAsync({
        domain: eip712Domain(CHAIN_ID, ESCROW_ADDRESS),
        types: settlementTypes,
        primaryType: 'Settlement',
        message: settlementFromJson(p.settlement),
      })
      await api(`/transactions/${view.publicId}/settlements/${p.id}/sign`, { body: { signature } })
      await qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      const parsed = parseTxError(e, tr)
      setError(parsed.rejected ? parsed.message : errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  const open = proposal && proposal.status === 'open' ? proposal : null
  const mySigned = open ? (view.myRole === 'buyer' ? open.buyerSig : open.sellerSig) : null
  const bothSigned = Boolean(open?.buyerSig && open?.sellerSig)
  const pBuyerRefund = open ? BigInt(open.settlement.buyerPriceRefund) : 0n

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-start gap-2">
        <Handshake className="mt-0.5 size-4 shrink-0 text-[var(--accent-hover)]" />
        <div>
          <h2 className="display text-lg font-semibold">{tr('Thỏa thuận chung (dàn xếp)', 'Mutual settlement')}</h2>
          <p className="text-sm text-[var(--muted)]">
            {tr('Cả hai bên cùng ký một cách chia giá. Hai khoản cọc luôn được hoàn đủ và không có tiền phạt.', 'Both parties sign one price split. Both deposits are always refunded in full, with no penalty.')}
          </p>
        </div>
      </div>

      <div className="inner space-y-3 p-4">
        <label className="label" htmlFor="refund">{tr('Hoàn lại cho Buyer từ giá (USDC)', 'Refund to Buyer from the price (USDC)')}</label>
        <input id="refund" className="field tabular-nums" inputMode="decimal" value={refund} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (/^\d*\.?\d{0,6}$/.test(v)) setRefund(v) }} placeholder={`0 - ${usdc(price)}`} />
        {refundValid && refundUnits !== null && (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="label !mb-0.5">Buyer {tr('nhận', 'receives')}</dt><dd className="tabular-nums font-semibold">{usdcWithCommas(refundUnits + buyerDeposit)} USDC <span className="text-xs font-normal text-[var(--muted)]">({usdcWithCommas(refundUnits)} + {usdcWithCommas(buyerDeposit)} {tr('cọc', 'deposit')})</span></dd></div>
            <div><dt className="label !mb-0.5">Seller {tr('nhận', 'receives')}</dt><dd className="tabular-nums font-semibold">{usdcWithCommas(price - refundUnits + sellerDeposit)} USDC <span className="text-xs font-normal text-[var(--muted)]">({usdcWithCommas(price - refundUnits)} + {usdcWithCommas(sellerDeposit)} {tr('cọc', 'deposit')})</span></dd></div>
          </dl>
        )}
        {refund !== '' && !refundValid && <p className="text-xs text-[var(--danger)]">{tr('Số tiền hoàn phải từ 0 đến giá thỏa thuận.', 'The refund must be between 0 and the agreed price.')}</p>}
        <button type="button" className="btn btn-ghost w-full" disabled={!refundValid || busy} onClick={() => void propose()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : open ? tr('Thay bằng đề xuất mới', 'Replace with a new proposal') : tr('Đề xuất dàn xếp', 'Propose settlement')}
        </button>
      </div>

      {open && (
        <div className="inner space-y-3 p-4">
          <div className="label">{tr('Đề xuất hiện tại', 'Current proposal')}</div>
          <p className="text-sm">
            Buyer: <span className="tabular-nums font-semibold">{usdcWithCommas(pBuyerRefund + buyerDeposit)} USDC</span> · Seller:{' '}
            <span className="tabular-nums font-semibold">{usdcWithCommas(price - pBuyerRefund + sellerDeposit)} USDC</span>
          </p>
          <p className="text-xs text-[var(--muted)]">{tr('Chữ ký có hiệu lực đến', 'Signatures valid until')} {formatDateTime(Number(open.settlement.deadline), lang)}</p>
          <ul className="space-y-1 text-sm">
            {([['Buyer', open.buyerSig], ['Seller', open.sellerSig]] as const).map(([label, sig]) => (
              <li key={label} className="flex items-center gap-2">{sig ? <CheckCircle2 className="size-4 text-[var(--success)]" /> : <CircleDashed className="size-4 text-[var(--subtle)]" />} {label} {sig ? tr('đã ký', 'signed') : tr('chưa ký', 'not signed')}</li>
            ))}
          </ul>
          {open.expired && <p className="text-sm text-[var(--warn)]">{tr('Đề xuất này đã hết hạn. Hãy tạo đề xuất mới.', 'This proposal expired. Create a new one.')}</p>}
          {!open.expired && !mySigned && (
            <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => void sign(open)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : tr('Ký đề xuất này', 'Sign this proposal')}
            </button>
          )}
          {!open.expired && mySigned && !bothSigned && <p className="text-sm text-[var(--muted)]">{tr('Bạn đã ký. Chờ bên kia ký đúng đề xuất này.', 'You signed. Waiting for the other side to sign this exact proposal.')}</p>}
          {!open.expired && bothSigned && open.buyerSig && open.sellerSig && (
            <ChainAction
              label={tr('Thực hiện dàn xếp trên chuỗi', 'Execute the settlement onchain')}
              hint={tr('Ai cũng có thể gửi giao dịch này. Sau đó mỗi bên tự claim.', 'Either side can submit this. Each side then claims.')}
              send={() =>
                writeContractAsync({
                  address: ESCROW_ADDRESS,
                  abi: escrowAbi,
                  functionName: 'executeMutualSettlement',
                  args: [BigInt(view.onChainId), settlementFromJson(open.settlement), open.buyerSig as `0x${string}`, open.sellerSig as `0x${string}`],
                  chainId: CHAIN_ID,
                })
              }
              onSubmitted={(hash) => api(`/transactions/${view.publicId}/tx`, { body: { txHash: hash, action: 'executeMutualSettlement' } }).catch(() => undefined)}
              onDone={async () => {
                await qc.invalidateQueries({ queryKey: key })
                onChanged()
              }}
            />
          )}
        </div>
      )}
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
    </section>
  )
}
