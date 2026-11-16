import { Lock } from 'lucide-react'
import { useLang } from '@/i18n'
import { useNow } from '@/hooks/useNow'
import { formatDateTime, formatDuration, usdcWithCommas } from '@/lib/format'
import { timeProgress } from '@/shared/protocol'

interface Props {
  priceUnits: bigint
  activatedAt: number
  handoverDeadline: number
  /** Locked states stop the normal animation. */
  locked: boolean
  lockedLabel?: string
}

/**
 * Informational time visualization only. The full price is already locked in escrow and nothing
 * is withdrawable before dual completion; the amount below is an illustrative time equivalent.
 */
export function ProgressTimeline({ priceUnits, activatedAt, handoverDeadline, locked, lockedLabel }: Props) {
  const { tr, lang } = useLang()
  const now = useNow(locked ? 60_000 : 1000)
  const progress = timeProgress(now, activatedAt, handoverDeadline)
  const pct = Math.round(progress * 1000) / 10
  const illustrative = (priceUnits * BigInt(Math.floor(progress * 1_000_000))) / 1_000_000n
  const remaining = handoverDeadline - now
  return (
    <section className="card space-y-4 p-5" aria-label={tr('Tiến độ thời gian', 'Time progress')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label !mb-0.5">{tr('100% giá đã được ký quỹ', '100% of the price is escrowed')}</div>
          <div className="text-sm text-[var(--muted)]">{tr('Có thể rút trước khi xác nhận: 0 USDC', 'Withdrawable before confirmation: 0 USDC')}</div>
        </div>
        {locked && (
          <span className="chip !bg-[#fde8ec] !text-[var(--danger)]">
            <Lock className="size-3" /> {lockedLabel ?? tr('Đã khóa', 'Locked')}
          </span>
        )}
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={tr('Tiến độ thời gian đến hạn bàn giao', 'Time progress to the handover deadline')}
      >
        <div className={`h-full rounded-full ${locked ? 'bg-[var(--subtle)]' : 'bg-[var(--accent)]'}`} style={{ width: `${pct}%`, transition: 'width 1s linear' }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span className="tabular-nums">{pct.toFixed(1)}%</span>
        <span>
          {remaining > 0
            ? tr(`Còn ${formatDuration(remaining, lang)} đến hạn bàn giao (${formatDateTime(handoverDeadline, lang)})`, `${formatDuration(remaining, lang)} to the handover deadline (${formatDateTime(handoverDeadline, lang)})`)
            : tr('Đã qua hạn bàn giao', 'Handover deadline passed')}
        </span>
      </div>
      <p className="rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-relaxed text-[var(--muted)]">
        {tr('Giá trị minh họa theo thời gian', 'Illustrative time equivalent')}: <span className="tabular-nums font-semibold text-[var(--ink-2)]">{usdcWithCommas(illustrative)} USDC</span>.{' '}
        {tr(
          'Đây không phải số tiền đã trả, đã vest hay có thể rút. Seller chỉ nhận tiền khi cả hai bên xác nhận hoàn tất hoặc có thỏa thuận chung.',
          'This is not paid, vested or withdrawable. The Seller is paid only on dual completion or a mutual settlement.',
        )}
      </p>
    </section>
  )
}
