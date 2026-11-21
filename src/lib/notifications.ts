import { usdcWithCommas, formatDateTime } from '@/lib/format'

export interface NotificationItem {
  key: string
  kind: string
  publicId: string | null
  at: number
  severity: 'info' | 'warn' | 'urgent'
  params: Record<string, string | number>
  read: boolean
}

type Tr = (vi: string, en: string) => string

/** Human text and link for one derived notification. Text lives here so the server only sends facts. */
export function describeNotification(n: NotificationItem, tr: Tr, lang: 'vi' | 'en'): { title: string; body: string; to: string } {
  const to = n.publicId ? `/transactions/${n.publicId}` : '/transactions'
  const at = (k: string) => (n.params[k] ? formatDateTime(Number(n.params[k]), lang) : '')
  switch (n.kind) {
    case 'fund_due':
      return { title: tr('Sắp hết hạn nạp tiền', 'Funding deadline is close'), body: tr(`Nạp phần của bạn trước ${at('deadline')}. Hết hạn mà chưa đủ thì khoản đã nạp được hoàn, không phạt.`, `Fund your part before ${at('deadline')}. If it is not complete by then, deposits are refunded with no penalty.`), to }
    case 'fund_expired':
      return { title: tr('Hết hạn nạp tiền', 'Funding window ended'), body: tr('Giao dịch chưa đủ tiền. Ai cũng gọi được lệnh hết hạn để các khoản đã nạp thành số chờ nhận.', 'The deal was not fully funded. Anyone can call expire so funded amounts become claimable.'), to }
    case 'handover_due':
      return { title: tr('Sắp tới hạn bàn giao', 'Handover deadline is close'), body: tr(`Tuyên bố bàn giao trước ${at('deadline')}. Quá hạn thì tiền bị khóa chờ xử lý.`, `Declare handover before ${at('deadline')}. Past it, funds lock for review.`), to }
    case 'ack_due':
      return { title: tr('Cần xác nhận đã nhận hàng', 'Please confirm receipt'), body: tr(`Người bán đã tuyên bố bàn giao. Phản hồi trước ${at('deadline')}.`, `The seller declared handover. Respond before ${at('deadline')}.`), to }
    case 'accept_due':
      return { title: tr('Sắp hết cửa sổ kiểm tra hàng', 'Inspection window is closing'), body: tr(`Chấp thuận hoặc mở tranh chấp trước ${at('deadline')}.`, `Accept or open a dispute before ${at('deadline')}.`), to }
    case 'late_unflagged':
      return { title: tr('Đã quá hạn bàn giao', 'Handover deadline passed'), body: tr('Ai cũng đánh dấu quá hạn được để Arbiter xem xét. Cho tới lúc đó tiền chưa tự động chuyển.', 'Anyone can flag it overdue so the Arbiter can review. Nothing moves automatically.'), to }
    case 'case_open':
      return { title: n.params.stage === 'disputed' ? tr('Giao dịch đang tranh chấp', 'Deal is in dispute') : tr('Giao dịch đã quá hạn', 'Deal is overdue'), body: tr('Tiền đang khóa. Bạn có thể gửi bằng chứng, hoặc hai bên cùng ký thỏa thuận chung.', 'Funds are locked. You can add evidence, or both sides can sign a mutual settlement.'), to }
    case 'buyer_funded':
      return { title: tr('Người mua đã nạp tiền', 'The buyer has funded'), body: tr('Phần của người mua đã vào hợp đồng.', "The buyer's part is in the contract."), to }
    case 'seller_funded':
      return { title: tr('Người bán đã nạp cọc', 'The seller has funded'), body: tr('Cọc của người bán đã vào hợp đồng.', "The seller's deposit is in the contract."), to }
    case 'activated':
      return { title: tr('Giao dịch đã kích hoạt', 'Deal is active'), body: tr('Đủ cả ba khoản. Có thể bàn giao ở ngoài ứng dụng.', 'All three amounts are in. Handover can happen outside the app.'), to }
    case 'expired':
      return { title: tr('Giao dịch hết hạn nạp', 'Deal expired unfunded'), body: tr('Các khoản đã nạp trở thành số chờ nhận về đúng ví gốc.', 'Funded amounts became claimable by their original wallets.'), to }
    case 'handover_declared':
      return { title: tr('Người bán đã tuyên bố bàn giao', 'The seller declared handover'), body: tr('Hãy kiểm tra hàng rồi xác nhận đã nhận.', 'Check the goods, then confirm receipt.'), to }
    case 'receipt_acknowledged':
      return { title: tr('Người mua xác nhận đã nhận', 'The buyer confirmed receipt'), body: tr('Cửa sổ kiểm tra của người mua đã bắt đầu.', "The buyer's inspection window has started."), to }
    case 'buyer_accepted':
      return { title: tr('Người mua đã chấp thuận hàng', 'The buyer accepted the goods'), body: tr('Giao dịch có thể chốt hoàn thành.', 'The deal can be finalized.'), to }
    case 'completed':
      return { title: tr('Giao dịch hoàn thành', 'Deal completed'), body: tr('Số chờ nhận đã được ghi có. Hãy nhận tiền từ ví của bạn.', 'Credits are assigned. Claim from your wallet.'), to }
    case 'overdue_flagged':
      return { title: tr('Giao dịch bị đánh dấu quá hạn', 'Deal flagged overdue'), body: tr('Tiền khóa chờ Arbiter hoặc thỏa thuận chung.', 'Funds are locked for the Arbiter or a mutual settlement.'), to }
    case 'dispute_opened':
      return { title: tr('Bên kia đã mở tranh chấp', 'The other side opened a dispute'), body: tr('Tiền đang khóa. Hãy gửi bằng chứng của bạn.', 'Funds are locked. Add your evidence.'), to }
    case 'ruling_preliminary':
      return { title: tr('Có phán quyết sơ bộ', 'Preliminary ruling issued'), body: tr(`Bạn có 72 giờ để kháng cáo, đến ${at('appealDeadline')}. Chưa có khoản nào nhận được.`, `You have 72 hours to appeal, until ${at('appealDeadline')}. Nothing is claimable yet.`), to }
    case 'appeal_due':
      return { title: tr('Sắp hết hạn kháng cáo', 'Appeal window is closing'), body: tr(`Kháng cáo một lần trước ${at('deadline')} nếu bạn không đồng ý.`, `Appeal once before ${at('deadline')} if you disagree.`), to }
    case 'ruling_appealed':
      return { title: tr('Bên kia đã kháng cáo', 'The other side appealed'), body: tr('Một người xem xét độc lập sẽ ra phán quyết cuối.', 'An independent reviewer will issue the final ruling.'), to }
    case 'ruling_final':
      return { title: tr('Có phán quyết cuối cùng', 'Final ruling'), body: tr('Số chờ nhận đã được ghi có. Hãy nhận tiền từ ví của bạn.', 'Credits are assigned. Claim from your wallet.'), to }
    case 'settled':
      return { title: tr('Thỏa thuận chung đã thực thi', 'Mutual settlement executed'), body: tr('Hai cọc được hoàn đủ, không phạt. Hãy nhận tiền.', 'Both deposits refunded in full, no penalty. Claim your funds.'), to }
    case 'claim_pending':
      return { title: tr('Bạn có tiền chờ nhận', 'You have funds to claim'), body: tr(`${usdcWithCommas(String(n.params.amount))} USDC đang chờ về ví của bạn.`, `${usdcWithCommas(String(n.params.amount))} USDC is waiting for your wallet.`), to }
    case 'draft_joined':
      return { title: tr('Đối tác đã tham gia', 'Your counterparty joined'), body: tr('Xem lại điều khoản và cùng ký.', 'Review the terms and sign together.'), to: `/transactions/${n.params.draftId}` }
    case 'ops_cases':
      return {
        title: tr(`${n.params.count} hồ sơ cần bạn xử lý`, `${n.params.count} case(s) need you`),
        body: n.params.role === 'reviewer' ? tr('Hàng đợi kháng cáo.', 'Appeal queue.') : tr('Hồ sơ quá hạn hoặc tranh chấp.', 'Overdue or disputed cases.'),
        to: n.params.role === 'reviewer' ? '/admin/appeals' : '/admin/cases',
      }
    default:
      return { title: n.kind, body: '', to }
  }
}
