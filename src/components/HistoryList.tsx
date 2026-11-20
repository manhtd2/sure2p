import { ExternalLink } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { useLang } from '@/i18n'
import { CHAIN_ID } from '@/lib/contracts'
import { formatDateTime, shortAddress, usdc } from '@/lib/format'
import type { HistoryEvent } from '@/lib/types'

const LABEL: Record<string, [string, string]> = {
  EscrowCreated: ['Escrow được tạo', 'Escrow created'],
  BuyerFunded: ['Buyer đã nạp tiền', 'Buyer funded'],
  SellerFunded: ['Seller đã nạp cọc', 'Seller funded'],
  EscrowActivated: ['Đã kích hoạt (đủ tiền)', 'Activated (fully funded)'],
  EscrowExpired: ['Hết hạn chưa nạp đủ, đã hoàn tiền', 'Expired unfunded, refunds credited'],
  HandoverDeclared: ['Seller khai báo đã bàn giao', 'Seller declared handover'],
  ReceiptAcknowledged: ['Buyer xác nhận đã nhận', 'Buyer acknowledged receipt'],
  BuyerAcceptanceConfirmed: ['Buyer chấp nhận hàng', 'Buyer accepted the goods'],
  OverdueFlagged: ['Đánh dấu quá hạn, tiền bị khóa', 'Flagged overdue, funds locked'],
  MutualCompletionFinalized: ['Hoàn tất, đã ghi có tiền', 'Completed, credits assigned'],
  DisputeOpened: ['Mở tranh chấp, tiền bị khóa', 'Dispute opened, funds locked'],
  MutualSettlementExecuted: ['Dàn xếp chung đã thực hiện', 'Mutual settlement executed'],
  PreliminaryRulingIssued: ['Arbiter ra phán quyết sơ bộ', 'Arbiter issued a preliminary ruling'],
  RulingAppealed: ['Một bên đã kháng cáo', 'A party appealed'],
  FinalRulingIssued: ['Appeal Reviewer ra phán quyết cuối cùng', 'Appeal Reviewer issued the final ruling'],
  RulingFinalized: ['Phán quyết đã chốt, đã ghi có tiền', 'Ruling finalized, credits assigned'],
  EvidenceAnchored: ['Mã băm bằng chứng được ghi lên chuỗi', 'Evidence hash anchored onchain'],
  CreditAssigned: ['Ghi có có thể claim', 'Credit assigned (claimable)'],
  Claimed: ['Đã claim về ví', 'Claimed to wallet'],
}

export function HistoryList({ events }: { events: HistoryEvent[] }) {
  const { tr, lang } = useLang()
  if (events.length === 0) return <p className="text-sm text-[var(--muted)]">{tr('Chưa có sự kiện nào được lập chỉ mục.', 'No indexed events yet.')}</p>
  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const l = LABEL[e.name]
        const amount = e.args.amount
        const detail =
          e.name === 'CreditAssigned' || e.name === 'Claimed'
            ? `${shortAddress(e.args.account)}: ${usdc(amount)} USDC`
            : e.name === 'MutualSettlementExecuted'
              ? `${tr('Hoàn giá cho Buyer', 'Buyer price refund')}: ${usdc(e.args.buyerPriceRefund)} USDC`
              : e.name === 'OverdueFlagged'
                ? tr(`Điều kiện ${e.args.trigger}`, `Trigger ${e.args.trigger}`)
                : e.name === 'PreliminaryRulingIssued' || e.name === 'FinalRulingIssued'
                  ? `${tr('Hoàn giá cho Buyer', 'Buyer price refund')}: ${usdc(e.args.buyerPriceRefund)} USDC · ${tr('cọc hoàn Buyer / Seller', 'deposit refund Buyer / Seller')}: ${usdc(e.args.buyerDepositRefund)} / ${usdc(e.args.sellerDepositRefund)} USDC`
                  : null
        return (
          <li key={`${e.txHash}-${e.logIndex}`} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <div className="font-medium">{l ? tr(l[0], l[1]) : e.name}</div>
              {detail && <div className="text-xs text-[var(--muted)]">{detail}</div>}
              <div className="text-xs text-[var(--subtle)]">{formatDateTime(e.timestamp, lang)}</div>
            </div>
            <a className="inline-flex shrink-0 items-center gap-1 text-xs text-[var(--accent-hover)] underline" href={buildTxExplorerUrl(CHAIN_ID, e.txHash)} target="_blank" rel="noopener noreferrer">
              Tx <ExternalLink className="size-3" />
            </a>
          </li>
        )
      })}
    </ol>
  )
}
