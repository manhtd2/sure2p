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

/** Friendly per-field messages, so a failed submit points at the exact field instead of a generic "fill everything" line. */
function fieldMessage(field: string, tr: (vi: string, en: string) => string): string {
  switch (field) {
    case 'title':
      return tr('Tên hàng cần ít nhất 3 ký tự.', 'Title needs at least 3 characters.')
    case 'description':
      return tr('Mô tả cần ít nhất 10 ký tự.', 'Description needs at least 10 characters.')
    case 'quantity':
      return tr('Nhập số lượng.', 'Enter a quantity.')
    case 'acceptanceCriteria':
      return tr('Tiêu chí cần ít nhất 5 ký tự.', 'Criteria need at least 5 characters.')
    case 'deliveryChannel':
      return tr('Kênh giao hàng cần ít nhất 2 ký tự.', 'Delivery channel needs at least 2 characters.')
    case 'priceUnits':
      return tr('Giá phải lớn hơn 0.', 'Price must be greater than zero.')
    case 'handoverDeadline':
      return tr('Hạn bàn giao không hợp lệ.', 'Handover deadline is invalid.')
    case 'buyerResponseSeconds':
      return tr('Thời gian phản hồi phải từ 1 giờ đến 30 ngày.', 'Response time must be between 1 hour and 30 days.')
    case 'inspectionSeconds':
      return tr('Thời gian kiểm tra phải từ 1 giờ đến 30 ngày.', 'Inspection time must be between 1 hour and 30 days.')
    default:
      return tr('Trường này chưa hợp lệ.', 'This field is invalid.')
  }
}

/** Zod field name -> form field key used for the inline error display. */
const FIELD_KEY: Record<string, string> = {
  title: 'title',
  description: 'description',
  quantity: 'quantity',
  acceptanceCriteria: 'criteria',
  deliveryChannel: 'channel',
  priceUnits: 'price',
  handoverDeadline: 'deadline',
  buyerResponseSeconds: 'responseH',
  inspectionSeconds: 'inspectH',
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const priceUnits = useMemo(() => safeParseUsdc(price), [price])
  const priceInvalid = price.trim() !== '' && priceUnits === 0n

  function clearField(key: string) {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
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
      const errs: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const zodField = String(issue.path[0] ?? '')
        const key = FIELD_KEY[zodField] ?? zodField
        if (key && !errs[key]) errs[key] = fieldMessage(zodField, tr)
      }
      setFieldErrors(errs)
      setError(tr('Kiểm tra các trường tô đỏ bên dưới.', 'Check the highlighted fields below.'))
      return
    }
    if (handoverDeadlineError(handoverDeadline, Math.floor(Date.now() / 1000))) {
      setFieldErrors({ deadline: tr('Hạn bàn giao phải cách hiện tại ít nhất 25 giờ vì escrow cần 24 giờ để nạp tiền.', 'The handover deadline must be at least 25 hours away because funding takes up to 24 hours.') })
      setError(tr('Kiểm tra các trường tô đỏ bên dưới.', 'Check the highlighted fields below.'))
      return
    }
    onSubmit(parsed.data)
  }

  const err = (key: string) => fieldErrors[key]
  const fieldClass = (key: string) => `field ${err(key) ? '!border-[var(--danger)]' : ''}`

  return (
    <form onSubmit={submit} className="space-y-4">
      {leading}
      <div>
        <label className="label" htmlFor="t-title">{tr('Tên hàng hóa hoặc dịch vụ', 'Goods or service title')}</label>
        <input id="t-title" className={fieldClass('title')} maxLength={120} minLength={3} required value={title} onChange={(e) => { setTitle(e.target.value); clearField('title') }} placeholder={tr('Ví dụ: Bộ file thiết kế logo', 'e.g. Logo design file set')} />
        {err('title') && <p className="mt-1 text-xs text-[var(--danger)]">{err('title')}</p>}
      </div>
      <div>
        <label className="label" htmlFor="t-desc">{tr('Mô tả chi tiết', 'Detailed description')}</label>
        <textarea id="t-desc" className={`${fieldClass('description')} min-h-24`} maxLength={2000} minLength={10} required value={description} onChange={(e) => { setDescription(e.target.value); clearField('description') }} />
        {err('description') && <p className="mt-1 text-xs text-[var(--danger)]">{err('description')}</p>}
        <p className="mt-1 text-xs text-[var(--subtle)]">{tr('Không ghi mật khẩu, khóa bản quyền hay thông tin truy cập bí mật vào đây.', 'Never put passwords, license keys or secret access details here.')}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="t-qty">{tr('Số lượng', 'Quantity')}</label>
          <input id="t-qty" className={fieldClass('quantity')} maxLength={40} required value={quantity} onChange={(e) => { setQuantity(e.target.value); clearField('quantity') }} />
          {err('quantity') && <p className="mt-1 text-xs text-[var(--danger)]">{err('quantity')}</p>}
        </div>
        <div>
          <label className="label" htmlFor="t-channel">{tr('Kênh giao hàng (mô tả)', 'Delivery channel (description)')}</label>
          <input id="t-channel" className={fieldClass('channel')} maxLength={200} minLength={2} required value={channel} onChange={(e) => { setChannel(e.target.value); clearField('channel') }} placeholder={tr('Email, tin nhắn, tải xuống...', 'Email, message, download...')} />
          {err('channel') && <p className="mt-1 text-xs text-[var(--danger)]">{err('channel')}</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="t-criteria">{tr('Tiêu chí chất lượng và nghiệm thu', 'Quality and acceptance criteria')}</label>
        <textarea id="t-criteria" className={`${fieldClass('criteria')} min-h-20`} maxLength={1000} minLength={5} required value={criteria} onChange={(e) => { setCriteria(e.target.value); clearField('criteria') }} />
        {err('criteria') && <p className="mt-1 text-xs text-[var(--danger)]">{err('criteria')}</p>}
      </div>
      <div className="inner p-4">
        <label className="label" htmlFor="t-price">{tr('Giá thỏa thuận (USDC)', 'Agreed price (USDC)')}</label>
        <input id="t-price" className={`${fieldClass('price')} display !text-2xl font-bold tabular-nums`} inputMode="decimal" required value={price} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (/^\d*\.?\d{0,6}$/.test(v)) setPrice(v); clearField('price') }} placeholder="0.00" />
        {priceInvalid && <p className="mt-1 text-xs text-[var(--danger)]">{tr('Nhập số hợp lệ, tối đa 6 chữ số thập phân.', 'Enter a valid number with at most 6 decimals.')}</p>}
        {err('price') && <p className="mt-1 text-xs text-[var(--danger)]">{err('price')}</p>}
        <div className="mt-3"><AmountBreakdown priceUnits={priceUnits} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="label" htmlFor="t-deadline">{tr('Hạn bàn giao', 'Handover deadline')}</label>
          <input id="t-deadline" type="datetime-local" className={fieldClass('deadline')} required value={deadline} onChange={(e) => { setDeadline(e.target.value); clearField('deadline') }} />
          {err('deadline') && <p className="mt-1 text-xs text-[var(--danger)]">{err('deadline')}</p>}
        </div>
        <div>
          <label className="label" htmlFor="t-resp">{tr('Buyer phản hồi (giờ)', 'Buyer response (hours)')}</label>
          <input id="t-resp" className={fieldClass('responseH')} tabular-nums inputMode="decimal" required value={responseH} onChange={(e) => { setResponseH(e.target.value.replace(/[^0-9.]/g, '')); clearField('responseH') }} />
          {err('responseH') && <p className="mt-1 text-xs text-[var(--danger)]">{err('responseH')}</p>}
        </div>
        <div>
          <label className="label" htmlFor="t-insp">{tr('Thời gian kiểm tra (giờ)', 'Inspection (hours)')}</label>
          <input id="t-insp" className={fieldClass('inspectH')} tabular-nums inputMode="decimal" required value={inspectH} onChange={(e) => { setInspectH(e.target.value.replace(/[^0-9.]/g, '')); clearField('inspectH') }} />
          {err('inspectH') && <p className="mt-1 text-xs text-[var(--danger)]">{err('inspectH')}</p>}
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
