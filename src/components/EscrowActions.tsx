import { useState } from 'react'
import { erc20Abi, keccak256, toBytes, type Hex } from 'viem'
import { useWriteContract } from 'wagmi'
import { AlertTriangle, Clock3, Lock } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime, formatDuration, usdcWithCommas } from '@/lib/format'
import type { EscrowView } from '@/lib/types'
import { overdueTriggerAt } from '@/shared/protocol'
import { CHAIN_STATE, useUsdcAccount, type ChainEscrow } from '@/hooks/useEscrowChain'
import { useNow } from '@/hooks/useNow'
import { ChainAction } from './ChainAction'

interface Props {
  view: EscrowView
  chain: ChainEscrow
  wallet: `0x${string}`
  onChanged: () => void
}

function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Every gate below is computed from the live chain struct, never from the indexer alone. */
export function EscrowActions({ view, chain, wallet, onChanged }: Props) {
  const { tr, lang } = useLang()
  const { writeContractAsync } = useWriteContract()
  const now = useNow()
  const { balance, allowance } = useUsdcAccount(wallet)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')

  const id = BigInt(view.onChainId)
  const state = Number(chain.state)
  const isBuyer = view.myRole === 'buyer'
  const isSeller = view.myRole === 'seller'
  const record = (action: string) => (hash: Hex) => api(`/transactions/${view.publicId}/tx`, { body: { txHash: hash, action } }).catch(() => undefined)

  const call = (functionName: 'fundBuyer' | 'fundSeller' | 'expireUnfunded' | 'acknowledgeReceipt' | 'confirmBuyerAcceptance' | 'finalizeMutualCompletion' | 'flagOverdue') =>
    () => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName, args: [id], chainId: CHAIN_ID })

  const trigger = overdueTriggerAt(now, {
    handoverDeadline: Number(chain.handoverDeadline),
    buyerResponseSeconds: Number(chain.buyerResponseSeconds),
    inspectionSeconds: Number(chain.inspectionSeconds),
    sellerHandoverDeclared: chain.sellerHandoverDeclared,
    sellerDeclaredAt: Number(chain.sellerDeclaredAt),
    buyerReceiptAcknowledged: chain.buyerReceiptAcknowledged,
    buyerAcknowledgedAt: Number(chain.buyerAcknowledgedAt),
    buyerAccepted: chain.buyerAccepted,
  })
  const effectivelyOverdue = state === CHAIN_STATE.Active && trigger !== 0
  const triggerText: Record<number, [string, string]> = {
    1: ['Seller chưa khai báo bàn giao trước hạn bàn giao.', 'The Seller did not declare handover by the handover deadline.'],
    2: ['Buyer chưa xác nhận đã nhận trong thời gian phản hồi.', 'The Buyer did not acknowledge receipt within the response window.'],
    3: ['Buyer chưa chấp nhận trong thời gian kiểm tra.', 'The Buyer did not accept within the inspection window.'],
  }

  // ---- Funding ----
  if (state === CHAIN_STATE.Funding) {
    const fundingDeadline = Number(chain.fundingDeadline)
    const remaining = fundingDeadline - now
    const myFunded = isBuyer ? chain.buyerFunded : chain.sellerFunded
    const need = isBuyer ? chain.price + chain.buyerDeposit : chain.sellerDeposit
    const haveAllowance = allowance.data ?? 0n
    const haveBalance = balance.data
    const short = haveBalance !== undefined && haveBalance < need
    return (
      <section className="card space-y-4 p-5">
        <div className="flex items-start gap-2">
          <Clock3 className="mt-0.5 size-4 shrink-0 text-[var(--accent-hover)]" />
          <div>
            <h2 className="display text-lg font-semibold">{tr('Nạp tiền ký quỹ', 'Fund the escrow')}</h2>
            <p className="text-sm text-[var(--muted)]">
              {remaining > 0
                ? tr(`Còn ${formatDuration(remaining, lang)} (đến ${formatDateTime(fundingDeadline, lang)}). Giao dịch chỉ bắt đầu khi cả hai bên nạp đủ.`, `${formatDuration(remaining, lang)} left (until ${formatDateTime(fundingDeadline, lang)}). The deal starts only when both sides are fully funded.`)
                : tr('Đã quá hạn nạp tiền. Bất kỳ ai cũng có thể hoàn tiền các khoản đã nạp, không phạt.', 'The funding window has passed. Anyone can trigger refunds of what was funded, with no penalty.')}
            </p>
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          <li>Buyer: {chain.buyerFunded ? tr('đã nạp', 'funded') : tr('chưa nạp', 'not funded')} ({usdcWithCommas(chain.price + chain.buyerDeposit)} USDC)</li>
          <li>Seller: {chain.sellerFunded ? tr('đã nạp', 'funded') : tr('chưa nạp', 'not funded')} ({usdcWithCommas(chain.sellerDeposit)} USDC)</li>
        </ul>
        {(chain.buyerFunded || chain.sellerFunded) && !(chain.buyerFunded && chain.sellerFunded) && (
          <p className="rounded-xl bg-[#fff4d6] p-3 text-xs text-[var(--warn)]">
            {tr('Mới có một bên nạp: giá chưa được khóa an toàn cho đến khi bên còn lại nạp đủ. Nếu hết hạn, khoản đã nạp được hoàn lại.', 'Only one side has funded: the price is not safely locked until the other side funds too. If time runs out, funded amounts are refunded.')}
          </p>
        )}
        {remaining > 0 && !myFunded && (
          <div className="space-y-3">
            <div className="inner p-3 text-sm">
              {tr('Bạn cần nạp', 'You need to fund')}: <span className="tabular-nums font-semibold">{usdcWithCommas(need)} USDC</span>
              {haveBalance !== undefined && <span className="ml-2 text-xs text-[var(--muted)]">{tr('Số dư USDC', 'USDC balance')}: {usdcWithCommas(haveBalance)}</span>}
            </div>
            {short && <p className="text-sm text-[var(--danger)]">{tr('Số dư USDC chưa đủ. Dùng nút "Get test USDC" ở thanh bên của Arc Studio.', 'Your USDC balance is too low. Use the "Get test USDC" button in the Arc Studio sidebar.')}</p>}
            {haveAllowance < need ? (
              <ChainAction
                label={tr(`Bước 1/2: Cho phép đúng ${usdcWithCommas(need)} USDC`, `Step 1/2: Allow exactly ${usdcWithCommas(need)} USDC`)}
                hint={tr('Chỉ cho phép đúng số tiền cần nạp, không phải vô hạn.', 'Approves only the exact amount, never unlimited.')}
                disabled={short}
                send={() => writeContractAsync({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [ESCROW_ADDRESS, need], chainId: CHAIN_ID })}
                onDone={async () => { await allowance.refetch() }}
              />
            ) : (
              <ChainAction
                label={tr(`Bước 2/2: Nạp ${usdcWithCommas(need)} USDC`, `Step 2/2: Fund ${usdcWithCommas(need)} USDC`)}
                disabled={short}
                send={call(isBuyer ? 'fundBuyer' : 'fundSeller')}
                onSubmitted={record(isBuyer ? 'fundBuyer' : 'fundSeller')}
                onDone={onChanged}
              />
            )}
          </div>
        )}
        {myFunded && <p className="text-sm text-[var(--success)]">{tr('Bạn đã nạp đủ phần của mình. Đang chờ bên còn lại.', 'You have funded your part. Waiting for the other side.')}</p>}
        {remaining <= 0 && <ChainAction label={tr('Hết hạn và hoàn tiền', 'Expire and refund')} variant="ghost" send={call('expireUnfunded')} onSubmitted={record('expireUnfunded')} onDone={onChanged} />}
      </section>
    )
  }

  // ---- Locked states ----
  if (state === CHAIN_STATE.Overdue || state === CHAIN_STATE.Disputed) {
    return (
      <section className="card space-y-2 p-5">
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Lock className="size-4" /> {state === CHAIN_STATE.Disputed ? tr('Đang tranh chấp: tiền bị khóa', 'Disputed: funds locked') : tr('Quá hạn: tiền bị khóa', 'Overdue: funds locked')}</h2>
        <p className="text-sm text-[var(--ink-2)]">
          {tr('Không ai rút được tiền. Phiên bản này chưa có Admin phân xử: lối thoát duy nhất là thỏa thuận chung do cả hai bên cùng ký ở bên dưới. Nếu hai bên không đồng ý, tiền vẫn bị khóa.', 'Nobody can withdraw. This release has no Admin adjudication: the only exit is the mutual settlement both parties sign below. If you cannot agree, funds stay locked.')}
        </p>
      </section>
    )
  }

  // ---- Active ----
  if (state !== CHAIN_STATE.Active) return null
  const declared = chain.sellerHandoverDeclared
  const acked = chain.buyerReceiptAcknowledged
  const accepted = chain.buyerAccepted
  return (
    <section className="card space-y-4 p-5">
      <h2 className="display text-lg font-semibold">{tr('Bàn giao và xác nhận', 'Handover and confirmation')}</h2>
      {effectivelyOverdue && (
        <div className="space-y-3 rounded-xl bg-[#fff4d6] p-4 text-sm text-[var(--warn)]">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span>{tr(...(triggerText[trigger]))} {tr('Giao dịch hiện coi như quá hạn và không thể hoàn tất thông thường. Tiền không tự động được trả.', 'The deal is now effectively overdue and cannot complete normally. Nothing is paid automatically.')}</span></div>
          <ChainAction label={tr('Đánh dấu quá hạn (khóa tiền)', 'Flag overdue (lock funds)')} variant="ghost" send={call('flagOverdue')} onSubmitted={record('flagOverdue')} onDone={onChanged} />
        </div>
      )}

      <ol className="space-y-1.5 text-sm">
        <li>{declared ? '✓' : '○'} {tr('Seller khai báo đã bàn giao ngoài sure2p', 'Seller declared handover outside sure2p')}</li>
        <li>{acked ? '✓' : '○'} {tr('Buyer xác nhận đã nhận (bắt đầu thời gian kiểm tra)', 'Buyer acknowledged receipt (starts the inspection window)')}</li>
        <li>{accepted ? '✓' : '○'} {tr('Buyer chấp nhận hàng đúng thỏa thuận', 'Buyer accepted conforming goods')}</li>
      </ol>

      {isSeller && !declared && (
        <div className="space-y-2">
          <label className="label" htmlFor="handover-note">{tr('Ghi chú bàn giao (chỉ hash được ghi lên chuỗi)', 'Handover note (only its hash goes onchain)')}</label>
          <input id="handover-note" className="field" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={tr('Ví dụ: đã gửi file qua email lúc 10:30', 'e.g. files emailed at 10:30')} />
          <ChainAction
            label={tr('Tôi đã bàn giao hàng', 'I have handed over the goods')}
            hint={tr('Đây chỉ là lời khai của bạn, không phải bằng chứng Buyer đã nhận. Bạn chưa rút được gì.', 'This is only your declaration, not proof the Buyer received anything. You cannot withdraw yet.')}
            disabled={note.trim().length < 3 || effectivelyOverdue}
            send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'declareHandover', args: [id, keccak256(toBytes(`${note.trim()}|${randomSalt()}`))], chainId: CHAIN_ID })}
            onSubmitted={record('declareHandover')}
            onDone={onChanged}
          />
        </div>
      )}
      {isSeller && declared && !accepted && <p className="text-sm text-[var(--muted)]">{tr('Đang chờ Buyer xác nhận. Seller chưa rút được tiền trước khi Buyer chấp nhận.', 'Waiting for the Buyer. The Seller cannot withdraw before the Buyer accepts.')}</p>}

      {isBuyer && !declared && <p className="text-sm text-[var(--muted)]">{tr('Đang chờ Seller khai báo đã bàn giao.', 'Waiting for the Seller to declare handover.')}</p>}
      {isBuyer && declared && !accepted && (
        <div className="space-y-3">
          {!acked && (
            <ChainAction label={tr('Xác nhận đã nhận hàng (bắt đầu kiểm tra)', 'Acknowledge receipt (start inspection)')} variant="ghost" disabled={effectivelyOverdue} send={call('acknowledgeReceipt')} onSubmitted={record('acknowledgeReceipt')} onDone={onChanged} />
          )}
          <ChainAction
            label={tr('Đã nhận và chấp nhận hàng', 'Received & Accepted')}
            hint={tr('Chỉ bấm khi hàng đã nhận và đúng thỏa thuận. Seller sẽ được nhận 100% giá.', 'Only confirm if the goods arrived and match the agreement. The Seller becomes entitled to 100% of the price.')}
            disabled={effectivelyOverdue}
            send={call('confirmBuyerAcceptance')}
            onSubmitted={record('confirmBuyerAcceptance')}
            onDone={onChanged}
          />
        </div>
      )}

      {declared && accepted && (
        <ChainAction
          label={tr('Hoàn tất giao dịch và ghi có tiền', 'Finalize and assign payouts')}
          hint={tr('Ai cũng có thể bấm. Sau đó mỗi bên tự claim về ví của mình.', 'Anyone can trigger this. Each side then claims to their own wallet.')}
          send={call('finalizeMutualCompletion')}
          onSubmitted={record('finalizeMutualCompletion')}
          onDone={onChanged}
        />
      )}

      {!accepted && (
        <details className="inner p-3">
          <summary className="cursor-pointer text-sm font-semibold">{tr('Có vấn đề? Mở tranh chấp', 'Problem? Open a dispute')}</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[var(--muted)]">{tr('Mở tranh chấp sẽ khóa toàn bộ tiền. Việc này không tự phạt ai. Ở bản này chỉ thỏa thuận chung mới giải phóng được tiền.', 'Opening a dispute locks all funds. It penalizes nobody by itself. In this release only a mutual settlement can release the funds.')}</p>
            <input className="field" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Lý do (chỉ hash được ghi lên chuỗi)', 'Reason (only its hash goes onchain)')} />
            <ChainAction
              label={tr('Mở tranh chấp và khóa tiền', 'Open dispute and lock funds')}
              variant="danger"
              disabled={reason.trim().length < 3}
              send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'openDispute', args: [id, keccak256(toBytes(`${reason.trim()}|${randomSalt()}`))], chainId: CHAIN_ID })}
              onSubmitted={record('openDispute')}
              onDone={onChanged}
            />
          </div>
        </details>
      )}
    </section>
  )
}
