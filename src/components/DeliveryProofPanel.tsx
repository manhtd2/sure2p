import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, PackageCheck } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { openProtectedFile } from '@/lib/attachments'
import { FILE_ACCEPT, mimeForFilename } from '@/shared/files'
import type { EvidenceFile } from '@/lib/types'

interface Props {
  publicId: string
  /** The Seller can add files after declaring handover. */
  canUpload: boolean
  /** Who is looking, to word the text. */
  viewer: 'buyer' | 'seller' | 'admin'
  /** Hide the empty state once the deal is over. */
  hideWhenEmpty?: boolean
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

const sizeLabel = (b: number) => (b < 1024 * 100 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`)

/**
 * What the Seller shows to prove goods were handed over (a screenshot, a receipt, a tracking number). The Buyer can open
 * every file before confirming receipt. It is supporting evidence only: sure2p does not deliver or check goods.
 */
export function DeliveryProofPanel({ publicId, canUpload, viewer, hideWhenEmpty }: Props) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = ['evidence', publicId]
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<{ files: EvidenceFile[]; maxBytes: number }>(`/transactions/${publicId}/evidence`),
    refetchInterval: 8000,
  })
  const files = (list.data?.files ?? []).filter((f) => f.kind === 'delivery')
  const maxBytes = list.data?.maxBytes ?? 2 * 1024 * 1024

  async function upload(file: File) {
    setError(null)
    if (file.size > maxBytes) {
      setError(tr(`Tệp lớn hơn ${sizeLabel(maxBytes)}.`, `The file is larger than ${sizeLabel(maxBytes)}.`))
      return
    }
    setBusy(true)
    try {
      await api(`/transactions/${publicId}/evidence`, {
        body: { kind: 'delivery', filename: file.name, mime: mimeForFilename(file.name) ?? 'text/plain', note: note.trim() || undefined, dataBase64: toBase64(await file.arrayBuffer()) },
      })
      setNote('')
      await qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      setError(errorText(e, tr))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  if (hideWhenEmpty && !canUpload && !list.isLoading && files.length === 0) return null

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="display flex items-center gap-2 text-lg font-semibold">
          <PackageCheck className="size-4" /> {tr('Bằng chứng giao hàng của người bán', "Seller's proof of delivery")}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {viewer === 'seller'
            ? tr(
                'Sau khi bàn giao, hãy tải ảnh chụp màn hình, biên nhận hoặc mã vận đơn để Buyer xem. Đây chỉ là bằng chứng hỗ trợ: sure2p không chuyển hàng và không xác minh hàng.',
                'After handing over, add a screenshot, receipt or tracking number for the Buyer to see. It is supporting evidence only: sure2p does not deliver or verify goods.',
              )
            : viewer === 'buyer'
              ? tr(
                  'Người bán đã tuyên bố bàn giao. Xem các tệp dưới đây trước khi xác nhận đã nhận. Chỉ mở tệp nếu bạn tin tưởng và đã đọc cảnh báo của kiểm tra cơ bản.',
                  'The Seller declared handover. Look at the files below before you confirm receipt. Only open a file if you trust it and have read the basic check warning.',
                )
              : tr('Tệp người bán đã nộp để chứng minh đã bàn giao.', 'Files the Seller added to show the handover happened.')}
        </p>
      </div>

      {canUpload && (
        <div className="inner space-y-2 p-3">
          <input className="field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Ghi chú (ví dụ: mã vận đơn, giờ gửi)', 'Note (for example a tracking number or the time sent)')} />
          <input
            ref={input}
            type="file"
            accept={FILE_ACCEPT}
            disabled={busy}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-2 file:text-sm file:font-medium"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
            }}
          />
          <p className="text-xs text-[var(--muted)]">{tr(`Tối đa 10 tệp, mỗi tệp ${sizeLabel(maxBytes)}. Tệp được mã hóa và kiểm tra cơ bản khi tải lên. Đã tải lên thì không xóa được.`, `Up to 10 files, ${sizeLabel(maxBytes)} each. Files are encrypted and get a basic check on upload. They cannot be deleted once added.`)}</p>
          {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
        </div>
      )}

      {list.isLoading ? null : files.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          {viewer === 'seller' ? tr('Bạn chưa tải bằng chứng giao hàng nào.', 'You have not added any proof of delivery yet.') : tr('Người bán chưa tải bằng chứng giao hàng.', 'The Seller has not added proof of delivery.')}
        </p>
      ) : (
        <ul className="space-y-3">
          {files.map((f) => (
            <li key={f.id} className="inner space-y-2 p-3 text-sm">
              <a
                className="inline-flex items-center gap-1.5 font-semibold underline"
                href={`/api/transactions/${publicId}/evidence?evidenceId=${f.id}`}
                download={f.filename}
                onClick={(e) => {
                  e.preventDefault()
                  openProtectedFile(`/api/transactions/${publicId}/evidence?evidenceId=${f.id}`, f.filename).catch((err) => setError(errorText(err, tr)))
                }}
              >
                <FileText className="size-4" /> {f.filename}
              </a>
              <div className="text-xs text-[var(--muted)]">{sizeLabel(f.size)} · {formatDateTime(f.createdAt, lang)}</div>
              {f.note && <p className="whitespace-pre-wrap break-words text-[var(--ink-2)]">{f.note}</p>}
              {f.scan?.verdict === 'warn' && (
                <p className="rounded-lg bg-[#fff4d6] p-2 text-xs text-[var(--warn)]">{tr('Cảnh báo từ kiểm tra cơ bản', 'Basic check warning')}: {f.scan.reasons.join('; ')}</p>
              )}
              <p className="mono break-all text-[11px] text-[var(--subtle)]">sha256 {f.sha256}</p>
            </li>
          ))}
        </ul>
      )}
      {error && !canUpload && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
    </section>
  )
}
