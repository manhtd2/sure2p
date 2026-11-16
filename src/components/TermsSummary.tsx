import { useLang } from '@/i18n'
import { formatDateTime, usdcWithCommas } from '@/lib/format'
import type { DealTerms } from '@/shared/protocol'

const hours = (s: number) => `${Math.round((s / 3600) * 10) / 10}h`

/** Read-only view of the business terms both parties sign. */
export function TermsSummary({ terms }: { terms: DealTerms }) {
  const { tr, lang } = useLang()
  const rows: Array<[string, string]> = [
    [tr('Mô tả', 'Description'), terms.description],
    [tr('Số lượng', 'Quantity'), terms.quantity],
    [tr('Tiêu chí nghiệm thu', 'Acceptance criteria'), terms.acceptanceCriteria],
    [tr('Kênh giao hàng', 'Delivery channel'), terms.deliveryChannel],
    [tr('Hạn bàn giao', 'Handover deadline'), formatDateTime(terms.handoverDeadline, lang)],
    [tr('Buyer phản hồi trong', 'Buyer responds within'), hours(terms.buyerResponseSeconds)],
    [tr('Thời gian kiểm tra', 'Inspection window'), hours(terms.inspectionSeconds)],
    [tr('Giá', 'Price'), `${usdcWithCommas(terms.priceUnits)} USDC`],
  ]
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className={label === rows[0][0] || label === rows[2][0] ? 'sm:col-span-2' : ''}>
          <dt className="label !mb-0.5">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-[var(--ink-2)]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Field-by-field comparison between two versions. Changed terms invalidate earlier signatures. */
export function AgreementDiff({ previous, current }: { previous: DealTerms; current: DealTerms }) {
  const { tr, lang } = useLang()
  const fmt = (key: keyof DealTerms, t: DealTerms): string => {
    if (key === 'priceUnits') return `${usdcWithCommas(t.priceUnits)} USDC`
    if (key === 'handoverDeadline') return formatDateTime(t.handoverDeadline, lang)
    if (key === 'buyerResponseSeconds' || key === 'inspectionSeconds') return hours(t[key])
    return String(t[key])
  }
  const labels: Record<keyof DealTerms, string> = {
    title: tr('Tên', 'Title'),
    description: tr('Mô tả', 'Description'),
    quantity: tr('Số lượng', 'Quantity'),
    acceptanceCriteria: tr('Tiêu chí nghiệm thu', 'Acceptance criteria'),
    deliveryChannel: tr('Kênh giao hàng', 'Delivery channel'),
    priceUnits: tr('Giá', 'Price'),
    handoverDeadline: tr('Hạn bàn giao', 'Handover deadline'),
    buyerResponseSeconds: tr('Buyer phản hồi', 'Buyer response'),
    inspectionSeconds: tr('Thời gian kiểm tra', 'Inspection window'),
  }
  const changed = (Object.keys(labels) as Array<keyof DealTerms>).filter((k) => previous[k] !== current[k])
  if (changed.length === 0) {
    return <p className="text-xs text-[var(--muted)]">{tr('Nội dung giống phiên bản trước (chỉ làm mới chữ ký).', 'Same content as the previous version (signatures refreshed only).')}</p>
  }
  return (
    <ul className="space-y-2 text-sm">
      {changed.map((k) => (
        <li key={k} className="rounded-xl bg-[#fff4d6]/70 p-3">
          <div className="label !mb-1">{labels[k]}</div>
          <div className="text-[var(--subtle)] line-through decoration-[var(--subtle)]/60">{fmt(k, previous)}</div>
          <div className="font-medium text-[var(--ink)]">{fmt(k, current)}</div>
        </li>
      ))}
    </ul>
  )
}
