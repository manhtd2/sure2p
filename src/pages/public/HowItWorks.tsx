import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'
import { fundingBreakdown } from '@/shared/protocol'
import { parseUsdc } from '@/onchain-money'
import { usdcWithCommas } from '@/lib/format'

export default function HowItWorks() {
  const { tr } = useLang()
  const [price, setPrice] = useState('100')
  const parsed = useMemo(() => {
    try {
      const v = parseUsdc(price.trim() || '0')
      return v > 0n ? fundingBreakdown(v) : null
    } catch {
      return null
    }
  }, [price])

  const steps: Array<[string, string, string, string]> = [
    ['Tạo đề xuất', 'Create a proposal', 'Một bên (người mua hoặc người bán) tạo bản nháp. Người tạo không tự động là người mua hay người bán: bạn chọn vai trò.', 'One side creates a draft. The creator is not automatically buyer or seller: you choose your role.'],
    ['Mời và thương lượng', 'Invite and negotiate', 'Gửi lời mời bằng liên kết, mã hoặc mã quét (24 giờ). Mỗi lần sửa điều khoản là một phiên bản mới. Lời mời không phải là đã đồng ý.', 'Send an invite by link, code or QR (24 hours). Every term change is a new version. An invite is not agreement.'],
    ['Cùng ký', 'Sign together', 'Cả hai ví ký cùng một phiên bản thỏa thuận. Sau đó ký quỹ được tạo trên chuỗi.', 'Both wallets sign the same agreement version. Then the escrow is created onchain.'],
    ['Khóa cọc', 'Lock deposits', 'Người mua nạp giá cộng cọc 25%, người bán nạp cọc 25%. Chỉ khi đủ cả hai, giao dịch mới hoạt động. Hạn nạp là 24 giờ.', 'The buyer funds the price plus a 25% deposit, the seller a 25% deposit. The deal starts only when both are in. The funding window is 24 hours.'],
    ['Giao hàng ở ngoài', 'Deliver outside', 'Hàng được trao đổi ngoài sure2p. Người bán tuyên bố bàn giao; tuyên bố này không chứng minh người mua đã nhận.', 'Goods move outside sure2p. The seller declares handover; that does not prove the buyer received anything.'],
    ['Xác nhận', 'Confirm', 'Người mua xác nhận đã nhận rồi chấp thuận hàng đúng thỏa thuận.', 'The buyer confirms receipt, then accepts the goods as agreed.'],
    ['Chốt và nhận tiền', 'Settle and claim', 'Người bán nhận đủ giá dù xong sớm; cả hai nhận lại cọc. Mỗi ví tự bấm nhận.', 'The seller gets the full price even if finished early; both get deposits back. Each wallet claims its own funds.'],
    ['Tranh chấp hoặc kháng nghị', 'Dispute or appeal', 'Quá hạn hay tranh chấp thì tiền bị khóa. Hai bên thỏa thuận chung, hoặc người phán quyết xử, với một vòng kháng nghị 72 giờ.', 'Overdue or disputed deals lock funds. The parties settle together, or a human arbiter rules, with one 72-hour appeal.'],
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Cách hoạt động', 'How it works')}</h1>
        <p className="mt-2 text-[var(--ink-2)]">
          {tr('Tám bước, từ lúc tạo đề xuất tới lúc nhận tiền. Hàng hóa luôn nằm ngoài sure2p.', 'Eight steps from proposal to claim. Goods always stay outside sure2p.')}
        </p>
      </header>

      <ol className="space-y-3">
        {steps.map(([vi, en, bodyVi, bodyEn], i) => (
          <li key={vi} className="card flex gap-4 p-4">
            <span className="display flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] font-bold text-white">{i + 1}</span>
            <div>
              <h2 className="font-semibold">{tr(vi, en)}</h2>
              <p className="text-sm text-[var(--ink-2)]">{tr(bodyVi, bodyEn)}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="card p-5" aria-labelledby="calc">
        <h2 id="calc" className="display text-lg font-bold">{tr('Thử với giá của bạn', 'Try your own price')}</h2>
        <label className="label mt-3" htmlFor="price">{tr('Giá hàng (USDC)', 'Goods price (USDC)')}</label>
        <input id="price" className="field max-w-xs" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        {parsed ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-4">
            {([
              [tr('Người mua nạp', 'Buyer funds'), parsed.buyerFunding],
              [tr('Người bán nạp', 'Seller funds'), parsed.sellerFunding],
              [tr('Cọc mỗi bên', 'Each deposit'), parsed.buyerDeposit],
              [tr('Tổng giữ', 'Total held'), parsed.totalEscrow],
            ] as Array<[string, bigint]>).map(([k, v]) => (
              <div key={k} className="inner p-3">
                <dt className="label">{k}</dt>
                <dd className="mono text-lg font-semibold">{usdcWithCommas(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{tr('Nhập một số lớn hơn 0, tối đa 6 chữ số thập phân.', 'Enter a number above 0 with up to 6 decimals.')}</p>
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">
          {tr('Ví dụ: giá 100 → người mua 125, người bán 25, tổng 150. Cọc = 25% giá, làm tròn lên tới đơn vị nhỏ nhất của USDC. Tiến độ trên màn hình chỉ phản ánh thời gian, không phải tiền trả dần.', 'Example: price 100 → buyer 125, seller 25, total 150. A deposit is 25% of the price rounded up to the smallest USDC unit. On-screen progress reflects time only, not instalments.')}
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link to="/transactions/new" className="btn btn-primary">{tr('Tạo giao dịch', 'Create a deal')}</Link>
        <Link to="/docs/trading/how-escrow-works" className="btn btn-ghost">{tr('Đọc chi tiết', 'Read more')}</Link>
      </div>
    </div>
  )
}
