import { useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useLang } from '@/i18n'
import { parseUsdc } from '@/onchain-money'
import { dealTermsSchema, handoverDeadlineError } from '@/shared/validation'
import { DEFAULT_INSPECTION_SECONDS, DEFAULT_RESPONSE_SECONDS, type DealTerms } from '@/shared/protocol'
import { fromLocalInput, toLocalInput, usdc } from '@/lib/format'
import { AmountBreakdown } from './AmountBreakdown'

interface Props {
  initial?: DealTerms
  submitLabel: string
  busy?: boolean
  onSubmit: (terms: DealTerms) => void
  leading?: ReactNode
}

function safeParseUsdc(value: string): bigint {
  try {
    return value.trim() === '' ? 0n : parseUsdc(value)
  } catch {
    return 0n
  }
}

export function TermsForm({ initial, submitLabel, busy, onSubmit, leading }: Props) {
  const { tr } = useLang()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [quantity, setQuantity] = useState(initial?.quantity ?? '1')
  const [criteria, setCriteria] = useState(initial?.acceptanceCriteria ?? '')
  const [channel, setChannel] = useState(initial?.deliveryChannel ?? '')
  const [price, setPrice] = useState(initial ? usdc(initial.priceUnits) : '')
  const [deadline, setDeadline] = useState(() => toLocalInput(initial?.handoverDeadline ?? Math.floor(Date.now() / 1000) + 7 * 86400))
  const [responseH, setResponseH] = useState(String((initial?.buyerResponseSeconds ?? DEFAULT_RESPONSE_SECONDS) / 3600))
  const [inspectH, setInspectH] = useState(String((initial?.inspectionSeconds ?? DEFAULT_INSPECTION_SECONDS) / 3600))
  const [error, setError] = useState<string | null>(null)

  const priceUnits = useMemo(() => safeParseUsdc(price), [price])
  const priceInvalid = price.trim() !== '' && priceUnits === 0n

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const handoverDeadline = fromLocalInput(deadline)
    const candidate = {
      title,
      description,
      quantity,
      acceptanceCriteria: criteria,
      deliveryChannel: channel,
      priceUnits: priceUnits.toString(),
      handoverDeadline,
      buyerResponseSeconds: Math.round(Number(responseH) * 3600),
      inspectionSeconds: Math.round(Number(inspectH) * 3600),
    }
    const parsed = dealTermsSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(tr('Vui lòng điền đủ và đúng các trường (giá phải lớn hơn 0, thời gian từ 1 giờ đến 30 ngày).', 'Please complete every field correctly (price above 0, durations between 1 hour and 30 days).'))
      return
    }
    if (handoverDeadlineError(handoverDeadline, Math.floor(Date.now() / 1000))) {
      setError(tr('Hạn bàn giao phải cách hiện tại ít nhất 25 giờ vì escrow cần 24 giờ để nạp tiền.', 'The handover deadline must be at least 25 hours away because funding takes up to 24 hours.'))
      return
    }
    onSubmit(parsed.data)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {leading}
      <div>
        <label className="label" htmlFor="t-title">{tr('Tên hàng hóa hoặc dịch vụ', 'Goods or service title')}</label>
        <input id="t-title" className="field" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr('Ví dụ: Bộ file thiết kế logo', 'e.g. Logo design file set')} />
      </div>
      <div>
        <label className="label" htmlFor="t-desc">{tr('Mô tả chi tiết', 'Detailed description')}</label>
        <textarea id="t-desc" className="field min-h-24" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <p className="mt-1 text-xs text-[var(--subtle)]">{tr('Không ghi mật khẩu, khóa bản quyền hay thông tin truy cập bí mật vào đây.', 'Never put passwords, license keys or secret access details here.')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="t-qty">{tr('Số lượng', 'Quantity')}</label>
          <input id="t-qty" className="field" maxLength={40} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="t-channel">{tr('Kênh giao hàng (mô tả)', 'Delivery channel (description)')}</label>
          <input id="t-channel" className="field" maxLength={200} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={tr('Email, tin nhắn, tải xuống...', 'Email, message, download...')} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="t-criteria">{tr('Tiêu chí chất lượng và nghiệm thu', 'Quality and acceptance criteria')}</label>
        <textarea id="t-criteria" className="field min-h-20" maxLength={1000} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      </div>
      <div className="inner p-4">
        <label className="label" htmlFor="t-price">{tr('Giá thỏa thuận (USDC)', 'Agreed price (USDC)')}</label>
        <input id="t-price" className="field display !text-2xl font-bold tabular-nums" inputMode="decimal" value={price} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (/^\d*\.?\d{0,6}$/.test(v)) setPrice(v) }} placeholder="0.00" />
        {priceInvalid && <p className="mt-1 text-xs text-[var(--danger)]">{tr('Nhập số hợp lệ, tối đa 6 chữ số thập phân.', 'Enter a valid number with at most 6 decimals.')}</p>}
        <div className="mt-3"><AmountBreakdown priceUnits={priceUnits} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="label" htmlFor="t-deadline">{tr('Hạn bàn giao', 'Handover deadline')}</label>
          <input id="t-deadline" type="datetime-local" className="field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="t-resp">{tr('Buyer phản hồi (giờ)', 'Buyer response (hours)')}</label>
          <input id="t-resp" className="field tabular-nums" inputMode="decimal" value={responseH} onChange={(e) => setResponseH(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div>
          <label className="label" htmlFor="t-insp">{tr('Thời gian kiểm tra (giờ)', 'Inspection (hours)')}</label>
          <input id="t-insp" className="field tabular-nums" inputMode="decimal" value={inspectH} onChange={(e) => setInspectH(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
      </div>
      <p className="text-xs text-[var(--subtle)]">
        {tr('Giờ hiển thị theo múi giờ của trình duyệt. Quá các mốc này giao dịch bị khóa, không tự động trả tiền.', "Times use your browser's timezone. Passing these deadlines locks the deal; it never pays out automatically.")}
      </p>
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : submitLabel}
      </button>
    </form>
  )
}
