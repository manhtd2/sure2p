import { useMemo, useState } from 'react'
import { useWriteContract } from 'wagmi'
import { concatHex, keccak256, toBytes } from 'viem'
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

type Hex32 = `0x${string}`

/** Root of the frozen evidence list: keccak256 of the sorted sha256 hashes, or a fixed marker when there is none. */
export function evidenceRootOf(hashes: string[]): Hex32 {
  if (hashes.length === 0) return keccak256(toBytes('sure2p:evidence:empty'))
  const sorted = [...hashes].map((h) => h.toLowerCase()).sort() as Hex32[]
  return keccak256(concatHex(sorted))
}

function parseOrNull(v: string): bigint | null {
  try {
    return parseUsdc(v.trim() === '' ? '0' : v)
  } catch {
    return null
  }
}

/**
 * Ruling form (spec F16, F18): price refund, then per side a fault flag, a fraud flag and the part of the
 * deposit that is returned. A side that is not at fault always gets its full deposit back; the rest of
 * a faulty side's deposit goes to the penalty wallet. Sent from the admin's own wallet.
 */
export function RulingForm({ view, kind, onDone }: Props) {
  const { tr } = useLang()
  const { writeContractAsync } = useWriteContract()
  const [refund, setRefund] = useState('0')
  const [buyerFault, setBuyerFault] = useState(false)
  const [sellerFault, setSellerFault] = useState(false)
  const [buyerFraud, setBuyerFraud] = useState(false)
  const [sellerFraud, setSellerFraud] = useState(false)
  const [buyerKeep, setBuyerKeep] = useState('') // deposit returned to Buyer when at fault
  const [sellerKeep, setSellerKeep] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const price = BigInt(view.price)
  const buyerDep = BigInt(view.buyerDeposit)
  const sellerDep = BigInt(view.sellerDeposit)
  const evidenceRoot = useMemo(() => evidenceRootOf(view.evidence.map((f) => f.sha256)), [view.evidence])

  const refundUnits = parseOrNull(refund)
  // A side that is not at fault gets everything back; a faulty side defaults to losing nothing until the admin lowers it.
  const buyerBack = buyerFault ? parseOrNull(buyerKeep === '' ? usdc(buyerDep) : buyerKeep) : buyerDep
  const sellerBack = sellerFault ? parseOrNull(sellerKeep === '' ? usdc(sellerDep) : sellerKeep) : sellerDep

  const refundOk = refundUnits !== null && refundUnits >= 0n && refundUnits <= price
  const buyerOk = buyerBack !== null && buyerBack >= 0n && buyerBack <= buyerDep
  const sellerOk = sellerBack !== null && sellerBack >= 0n && sellerBack <= sellerDep
  const all = refundOk && buyerOk && sellerOk && refundUnits !== null && buyerBack !== null && sellerBack !== null
  const valid = all && reason.trim().length >= 10 && confirmed && !view.isParty
  const preview = all
    ? rulingSplit(view, {
        buyerPriceRefund: refundUnits.toString(),
        buyerDepositRefund: buyerBack.toString(),
        sellerDepositRefund: sellerBack.toString(),
      })
    : null

  const side = (
    name: 'Buyer' | 'Seller',
    deposit: bigint,
    fault: boolean,
    setFault: (v: boolean) => void,
    fraud: boolean,
    setFraud: (v: boolean) => void,
    keep: string,
    setKeep: (v: string) => void,
    ok: boolean,
  ) => (
    <fieldset className="inner space-y-2 p-3">
      <legend className="label px-1">{name} · {tr('cọc', 'deposit')} {usdc(deposit)} USDC</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fault} onChange={(e) => { setFault(e.target.checked); if (!e.target.checked) { setFraud(false); setKeep('') } }} />
        {tr('Bên này có lỗi', 'This side is at fault')}
      </label>
      {fault ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fraud} onChange={(e) => setFraud(e.target.checked)} />
            {tr('Xác nhận gian lận', 'Confirm fraud')}
          </label>
          <label className="block space-y-1 text-sm">
            <span className="label">{tr(`Cọc hoàn lại cho ${name} (0 đến ${usdc(deposit)}); phần còn lại về ví phạt`, `Deposit returned to ${name} (0 to ${usdc(deposit)}); the rest goes to the penalty wallet`)}</span>
            <div className="flex gap-2">
              <input className="field" inputMode="decimal" value={keep === '' ? usdc(deposit) : keep} onChange={(e) => setKeep(e.target.value)} />
              <button type="button" className="btn btn-ghost !px-3 text-xs" onClick={() => setKeep('0')}>{tr('Phạt 100%', 'Penalty 100%')}</button>
            </div>
            {!ok && <span className="text-xs text-[var(--danger)]">{tr('Số tiền không hợp lệ hoặc vượt cọc.', 'Invalid amount or above the deposit.')}</span>}
          </label>
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">{tr('Không lỗi nên cọc được hoàn đủ.', 'Not at fault, so the deposit is refunded in full.')}</p>
      )}
    </fieldset>
  )

  return (
    <section className="card space-y-4 p-5">
      <h2 className="display text-lg font-semibold">{kind === 'prelim' ? tr('Ra phán quyết sơ bộ', 'Issue a preliminary ruling') : tr('Ra phán quyết cuối cùng', 'Issue the final ruling')}</h2>
      {view.isParty && <p className="rounded-xl bg-[#fde8ec] p-3 text-sm text-[var(--danger)]" role="alert">{tr('Ví này là một bên của giao dịch nên hợp đồng sẽ từ chối phán quyết.', 'This wallet is a party of the deal, so the contract will reject the ruling.')}</p>}
      <label className="block space-y-1 text-sm">
        <span className="label">{tr(`Hoàn lại cho Buyer từ giá (0 đến ${usdc(price)} USDC)`, `Refund to Buyer from the price (0 to ${usdc(price)} USDC)`)}</span>
        <input className="field max-w-xs" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} />
        {!refundOk && <span className="text-xs text-[var(--danger)]">{tr('Số tiền không hợp lệ.', 'Invalid amount.')}</span>}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {side('Buyer', buyerDep, buyerFault, setBuyerFault, buyerFraud, setBuyerFraud, buyerKeep, setBuyerKeep, buyerOk)}
        {side('Seller', sellerDep, sellerFault, setSellerFault, sellerFraud, setSellerFraud, sellerKeep, setSellerKeep, sellerOk)}
      </div>
      {preview && (
        <p className="inner p-3 text-sm" role="status">
          {tr('Kết quả', 'Result')}: Buyer <strong className="tabular-nums">{usdcWithCommas(preview.buyer)}</strong>, Seller <strong className="tabular-nums">{usdcWithCommas(preview.seller)}</strong>, {tr('ví phạt', 'penalty wallet')} <strong className="tabular-nums">{usdcWithCommas(preview.penalty)}</strong> USDC
          {' '}({tr('tổng', 'total')} {usdcWithCommas(preview.buyer + preview.seller + preview.penalty)} = {tr('giá', 'price')} + {tr('hai khoản cọc', 'both deposits')})
        </p>
      )}
      {(buyerFraud || sellerFraud) && (
        <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]">
          {kind === 'prelim'
            ? tr('Cờ gian lận trong phán quyết sơ bộ hiện cho hai bên thấy và chỉ được tính là đã xác nhận khi phán quyết trở thành cuối cùng.', 'A fraud flag in a preliminary ruling is visible to both sides and only counts as confirmed once the ruling becomes final.')
            : tr('Phán quyết cuối cùng với cờ gian lận cho phép người quản trị bảo mật cấm tài khoản mở giao dịch mới.', 'A final ruling with a fraud flag lets the security admin ban the account from opening new deals.')}
        </p>
      )}
      <textarea className="field min-h-28" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Lý do phán quyết dựa trên bằng chứng (hai bên sẽ đọc được)', 'Reasoning based on the evidence (both parties can read it)')} />
      <p className="mono break-all text-[10px] text-[var(--subtle)]">{tr('Gốc danh sách bằng chứng', 'Evidence list root')} {evidenceRoot} ({view.evidence.length} {tr('tệp', 'files')})</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>{kind === 'prelim' ? tr('Tôi hiểu phán quyết được ghi lên chuỗi và sẽ có hiệu lực nếu không ai kháng cáo trong 72 giờ.', 'I understand this is recorded onchain and takes effect unless someone appeals within 72 hours.') : tr('Tôi hiểu phán quyết này là cuối cùng và không thể đổi.', 'I understand this ruling is final and cannot be changed.')}</span>
      </label>
      <ChainAction
        label={kind === 'prelim' ? tr('Ghi phán quyết sơ bộ lên chuỗi', 'Record preliminary ruling onchain') : tr('Ghi phán quyết cuối cùng lên chuỗi', 'Record final ruling onchain')}
        disabled={!valid}
        send={async () => {
          const note = await api<{ hash: Hex32 }>(`/admin/cases/${view.publicId}?action=notes`, { body: { text: reason.trim() } })
          return writeContractAsync({
            address: ESCROW_ADDRESS,
            abi: escrowAbi,
            functionName: kind === 'prelim' ? 'issuePreliminaryRuling' : 'issueFinalRuling',
            args: [
              BigInt(view.onChainId),
              {
                agreementHash: view.agreementHash as Hex32,
                buyerPriceRefund: refundUnits ?? 0n,
                buyerDepositRefund: buyerBack ?? 0n,
                sellerDepositRefund: sellerBack ?? 0n,
                buyerAtFault: buyerFault,
                sellerAtFault: sellerFault,
                buyerFraud: buyerFault && buyerFraud,
                sellerFraud: sellerFault && sellerFraud,
                reasonHash: note.hash,
                evidenceRoot,
              },
            ],
            chainId: CHAIN_ID,
          })
        }}
        onDone={onDone}
      />
    </section>
  )
}
