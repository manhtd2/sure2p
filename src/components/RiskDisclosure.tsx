import { useState } from 'react'
import { Scale } from 'lucide-react'
import { useLang } from '@/i18n'
import { usdcWithCommas } from '@/lib/format'
import { fundingBreakdown } from '@/shared/protocol'

interface Props {
  priceUnits: bigint
  buyerWallet: string | null
  sellerWallet: string | null
  /** Called with true once the party explicitly acknowledges; false if they un-tick. */
  onAcknowledge: (ack: boolean) => void
}

/** Mandatory pre-sign disclosure. Both parties must acknowledge it before signing or funding. */
export function RiskDisclosure({ priceUnits, buyerWallet, sellerWallet, onAcknowledge }: Props) {
  const { tr } = useLang()
  const [ack, setAck] = useState(false)
  const b = fundingBreakdown(priceUnits)
  const items: Array<[string, string]> = [
    [
      'Buyer nạp 100% giá hàng cộng khoản cọc bảo đảm bằng 25% giá; Seller nạp một khoản cọc 25% riêng. Mỗi khoản cọc làm tròn lên đơn vị USDC nhỏ nhất.',
      'The Buyer deposits 100% of the goods price plus a security deposit of 25% of that price; the Seller deposits a separate 25% security deposit. Each deposit is rounded up to the next USDC unit.',
    ],
    [
      'Tiền do hợp đồng thông minh sure2p giữ, chưa nằm trong ví Seller. Khi hoàn tất hợp lệ, Seller được nhận 100% giá (kể cả hoàn tất sớm) và cả hai khoản cọc được hoàn.',
      "Funds are held by the sure2p smart contract, not yet in the Seller's wallet. On valid completion the Seller is entitled to 100% of the price (even if completed early) and both deposits are refunded.",
    ],
    [
      'Khi có tranh chấp hoặc quá hạn, toàn bộ tiền bị khóa. Không có khoản nào tự động được trả chỉ vì hết giờ hoặc vì một bên im lặng.',
      'When disputed or overdue, all funds are locked. Nothing is paid automatically because a countdown ends or a party is silent.',
    ],
    [
      'Phiên bản này CHƯA có Admin phân xử. Tiền bị khóa chỉ được giải phóng bằng thỏa thuận chung do cả hai bên cùng ký (chia lại giá, hoàn đủ cả hai khoản cọc). Nếu hai bên không đồng ý, tiền vẫn bị khóa. Phân xử bởi Admin, kháng cáo một lần trong 72 giờ và phạt cọc tối đa 100% khoản cọc của bên có lỗi dự kiến ở bản sau và chưa hoạt động.',
      'This release has NO Admin adjudication yet. Locked funds can only be released by a mutual settlement signed by both parties (price split chosen by you, both deposits refunded in full). If the parties never agree, the funds stay locked. Admin rulings, one 72-hour appeal and deposit penalties of up to 100% of an at-fault party\'s own deposit are planned for a later release and are not active.',
    ],
    [
      'sure2p không giao, lưu trữ hay xác minh hàng hóa. Hai bên trao đổi bên ngoài sure2p. Không có bảo đảm về tính đúng đắn của bất kỳ phán quyết nào của con người.',
      'sure2p does not deliver, host or verify the goods. The parties exchange them outside sure2p. There is no guarantee that any human decision is correct or fair.',
    ],
    [
      'Rủi ro khác: mất khóa ví thì không thể lấy lại tiền (OTP điện thoại không khôi phục được ví); phí gas trả bằng USDC; OTP điện thoại không chứng minh một người duy nhất; bằng chứng nhạy cảm cần được bảo vệ.',
      'Other risks: if you lose your wallet key funds cannot be recovered (phone OTP cannot restore a wallet); gas is paid in USDC; a phone number does not prove a unique person; sensitive evidence needs care.',
    ],
  ]
  return (
    <section className="inner space-y-3 p-4" aria-label={tr('Điều kiện ký quỹ và tranh chấp', 'Escrow and dispute conditions')}>
      <h3 className="display flex items-center gap-2 text-base font-semibold">
        <Scale className="size-4" /> {tr('sure2p - Điều kiện ký quỹ và tranh chấp', 'sure2p - Escrow & dispute conditions')}
      </h3>
      <ul className="space-y-2 text-sm leading-relaxed text-[var(--ink-2)]">
        {items.map(([vi, en]) => (
          <li key={en} className="flex gap-2">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--subtle)]" />
            <span>{tr(vi, en)}</span>
          </li>
        ))}
      </ul>
      {priceUnits > 0n && (
        <dl className="grid gap-2 rounded-xl bg-[var(--surface-muted)] p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="label !mb-0.5">{tr('Buyer nạp (giá + cọc)', 'Buyer funds (price + deposit)')}</dt>
            <dd className="tabular-nums font-semibold">{usdcWithCommas(b.buyerFunding)} USDC</dd>
          </div>
          <div>
            <dt className="label !mb-0.5">{tr('Seller nạp (cọc)', 'Seller funds (deposit)')}</dt>
            <dd className="tabular-nums font-semibold">{usdcWithCommas(b.sellerFunding)} USDC</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label !mb-0.5">{tr('Ví nhận cố định', 'Fixed payout wallets')}</dt>
            <dd className="mono break-all">
              Buyer: {buyerWallet ?? '-'}
              <br />
              Seller: {sellerWallet ?? '-'}
            </dd>
          </div>
        </dl>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-white/70 p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0"
          checked={ack}
          onChange={(e) => {
            setAck(e.target.checked)
            onAcknowledge(e.target.checked)
          }}
        />
        <span>
          {tr(
            'Tôi đã đọc và hiểu các điều kiện trên. Việc ký sẽ ràng buộc tôi với thỏa thuận và phiên bản chính sách hiện tại.',
            'I have read and understood the conditions above. Signing commits me to the current agreement and policy version.',
          )}
        </span>
      </label>
    </section>
  )
}
