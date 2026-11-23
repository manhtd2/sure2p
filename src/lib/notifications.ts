import { usdcWithCommas, formatDateTime } from '@/lib/format'

export interface TodoItem {
  key: string
  kind: string
  publicId: string | null
  draftId: string | null
  waitingOn: 'me' | 'other' | 'arbiter' | 'reviewer' | 'anyone'
  deadline: number | null
  action: { tool: string; input: Record<string, string> } | null
}

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
    case 'delivery_proof':
      return { title: tr(`Người bán đã tải ${n.params.count} tệp bằng chứng giao hàng`, `The seller added ${n.params.count} proof-of-delivery file(s)`), body: tr('Xem các tệp trước khi xác nhận đã nhận. Đây là bằng chứng hỗ trợ, sure2p không xác minh hàng.', 'Look at the files before you confirm receipt. They are supporting evidence; sure2p does not verify goods.'), to }
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

/** What a next step means in plain words. Only facts come from the server; the wording is here. */
export function describeTodo(t: TodoItem, tr: Tr): { title: string; hint: string; to: string } {
  const to = t.publicId ? `/transactions/${t.publicId}` : t.draftId ? `/transactions/${t.draftId}` : '/transactions'
  switch (t.kind) {
    case 'fund': return { title: tr('Nạp phần của bạn', 'Fund your part'), hint: tr('Cho phép chuyển đúng số USDC rồi nạp. Đủ cả hai bên thì giao dịch mới hoạt động.', 'Allow exactly that much USDC, then fund. The deal starts only when both sides are in.'), to }
    case 'wait_fund': return { title: tr('Chờ bên kia nạp tiền', 'Waiting for the other side to fund'), hint: tr('Bạn đã nạp xong. Hết hạn mà chưa đủ thì khoản đã nạp được hoàn, không phạt.', 'Your part is in. If it is not complete by the deadline, funded amounts are refunded with no penalty.'), to }
    case 'expire': return { title: tr('Hết hạn nạp tiền: gọi lệnh hết hạn', 'Funding window ended: call expire'), hint: tr('Ai cũng gọi được. Các khoản đã nạp thành số chờ nhận về đúng ví gốc.', 'Anyone can. Funded amounts become claimable by their original wallets.'), to }
    case 'handover': return { title: tr('Bàn giao hàng rồi tuyên bố bàn giao', 'Hand over, then declare handover'), hint: tr('Giao hàng ngoài ứng dụng rồi tuyên bố. Tuyên bố chưa chứng minh người mua đã nhận.', 'Deliver outside the app, then declare. A declaration does not prove the buyer received it.'), to }
    case 'wait_handover': return { title: tr('Chờ người bán bàn giao', 'Waiting for the seller to hand over'), hint: tr('Quá hạn bàn giao mà chưa tuyên bố thì giao dịch có thể bị đánh dấu quá hạn.', 'If the deadline passes without a declaration the deal can be flagged overdue.'), to }
    case 'wait_ack': return { title: tr('Chờ người mua xác nhận đã nhận', 'Waiting for the buyer to confirm receipt'), hint: tr('Người mua phải phản hồi trong cửa sổ phản hồi.', 'The buyer must respond within the response window.'), to }
    case 'ack': return { title: tr('Xác nhận bạn đã nhận hàng', 'Confirm you received the goods'), hint: tr('Chỉ xác nhận nếu bạn thật sự đã nhận. Việc này bắt đầu cửa sổ kiểm tra của bạn.', 'Confirm only if you really have them. This starts your inspection window.'), to }
    case 'wait_accept': return { title: tr('Chờ người mua chấp thuận', 'Waiting for the buyer to accept'), hint: tr('Người mua đang trong cửa sổ kiểm tra.', 'The buyer is inside the inspection window.'), to }
    case 'accept': return { title: tr('Kiểm tra hàng rồi chấp thuận hoặc mở tranh chấp', 'Inspect, then accept or open a dispute'), hint: tr('Hàng đúng thỏa thuận thì chấp thuận. Không đúng thì mở tranh chấp trước khi hết cửa sổ kiểm tra.', 'If it matches, accept. If not, open a dispute before the inspection window ends.'), to }
    case 'finalize': return { title: tr('Chốt giao dịch', 'Finalize the deal'), hint: tr('Người bán nhận đủ giá, hai bên nhận lại cọc. Sau đó mỗi ví tự nhận phần của mình.', 'The seller gets the full price, both get deposits back. Then each wallet claims its own part.'), to }
    case 'flag_overdue': return { title: tr('Đã quá hạn bàn giao: có thể đánh dấu quá hạn', 'Handover is overdue: it can be flagged'), hint: tr('Ai cũng đánh dấu được để Arbiter xem xét. Tiền không tự chuyển.', 'Anyone can flag it for the Arbiter. Nothing moves by itself.'), to }
    case 'wait_arbiter': return { title: tr('Tiền đang khóa, chờ Arbiter', 'Funds locked, waiting for the Arbiter'), hint: tr('Bạn có thể gửi bằng chứng, hoặc hai bên cùng ký thỏa thuận chung.', 'You can add evidence, or both sides can sign a mutual settlement.'), to }
    case 'wait_reviewer': return { title: tr('Đã kháng cáo, chờ người xem xét', 'Appealed, waiting for the reviewer'), hint: tr('Phán quyết của người xem xét là chung cuộc.', "The reviewer's ruling is final."), to }
    case 'appeal_window': return { title: tr('Có phán quyết sơ bộ: kháng cáo nếu không đồng ý', 'Preliminary ruling: appeal if you disagree'), hint: tr('Kháng cáo một lần cho cả vụ. Không kháng cáo thì phán quyết thành cuối sau 72 giờ.', 'One appeal for the whole case. Without one the ruling becomes final after 72 hours.'), to }
    case 'finalize_ruling': return { title: tr('Hết hạn kháng cáo: chốt phán quyết', 'Appeal window over: finalize the ruling'), hint: tr('Ai cũng chốt được. Sau đó từng ví tự nhận phần của mình.', 'Anyone can finalize. Then each wallet claims its own part.'), to }
    case 'claim': return { title: tr('Nhận tiền về ví của bạn', 'Claim funds to your wallet'), hint: tr('Tiền đã được ghi có nhưng chỉ vào ví sau giao dịch nhận tiền của chính ví đó.', 'The money is credited but reaches the wallet only after that wallet claims.'), to }
    case 'invite': return { title: tr('Mời bên còn lại', 'Invite the other side'), hint: tr('Một liên kết, mã hoặc mã quét, hết hạn sau 24 giờ.', 'One link, code or QR, valid for 24 hours.'), to }
    case 'sign_agreement': return { title: tr('Xem lại và ký thỏa thuận', 'Review and sign the agreement'), hint: tr('Cả hai ví phải ký cùng một phiên bản. Mỗi lần sửa sẽ hủy chữ ký cũ.', 'Both wallets must sign the same version. Any change cancels earlier signatures.'), to }
    case 'create_escrow': return { title: tr('Tạo ký quỹ trên chuỗi', 'Create the escrow onchain'), hint: tr('Cả hai đã ký. Một bên gửi giao dịch tạo ký quỹ; hạn nạp 24 giờ tính từ lúc đó.', 'Both signed. One side sends the create transaction; the 24 hour funding window starts then.'), to }
    case 'wait_escrow': return { title: tr('Đang chờ ký quỹ được ghi nhận', 'Waiting for the escrow to be recorded'), hint: tr('Giao dịch đã gửi, bộ quét sẽ cập nhật sau vài giây.', 'The transaction was sent; the indexer updates in a few seconds.'), to }
    default: return { title: t.kind, hint: '', to }
  }
}
