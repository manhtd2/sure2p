import { fundingBreakdown } from '@/shared/protocol'
import { useLang } from '@/i18n'
import { usdcWithCommas } from '@/lib/format'
import { TokenUSDC } from '@web3icons/react'

/** Exact split for a price, computed with the same ceil(price/4) rule as the contract. */
export function AmountBreakdown({ priceUnits, emphasis = 'total' }: { priceUnits: bigint; emphasis?: 'total' | 'none' }) {
  const { tr } = useLang()
  if (priceUnits <= 0n) {
    return (
      <div className="inner p-4 text-sm text-[var(--muted)]">
        {tr('Nhập giá để xem số tiền Buyer và Seller cần ký quỹ.', 'Enter a price to see what Buyer and Seller must escrow.')}
      </div>
    )
  }
  const b = fundingBreakdown(priceUnits)
  const rows: Array<[string, bigint, string?]> = [
    [tr('Giá hàng hóa (Buyer)', 'Goods price (Buyer)'), b.price],
    [tr('Cọc Buyer (25%, làm tròn lên)', 'Buyer deposit (25%, rounded up)'), b.buyerDeposit],
    [tr('Cọc Seller (25%, làm tròn lên)', 'Seller deposit (25%, rounded up)'), b.sellerDeposit],
  ]
  return (
    <div className="inner p-4">
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-[var(--muted)]">{label}</dt>
            <dd className="tabular-nums font-medium">{usdcWithCommas(value)} USDC</dd>
          </div>
        ))}
      </dl>
      <div className="my-3 h-px bg-[var(--border)]" />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="label !mb-0.5">{tr('Buyer nạp', 'Buyer funds')}</div>
          <div className="display flex items-center gap-1 text-lg font-bold tabular-nums">
            <TokenUSDC variant="branded" size={16} />
            {usdcWithCommas(b.buyerFunding)}
          </div>
        </div>
        <div>
          <div className="label !mb-0.5">{tr('Seller nạp', 'Seller funds')}</div>
          <div className="display flex items-center gap-1 text-lg font-bold tabular-nums">
            <TokenUSDC variant="branded" size={16} />
            {usdcWithCommas(b.sellerFunding)}
          </div>
        </div>
      </div>
      {emphasis === 'total' && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {tr('Hợp đồng giữ tổng cộng', 'The contract holds a total of')}{' '}
          <span className="font-semibold tabular-nums text-[var(--ink)]">{usdcWithCommas(b.totalEscrow)} USDC</span>
          {tr(
            '. Với giá rất nhỏ, làm tròn lên khiến tỷ lệ 25% chỉ gần đúng.',
            '. For very small prices, rounding up makes the 25% only approximate.',
          )}
        </p>
      )}
    </div>
  )
}
