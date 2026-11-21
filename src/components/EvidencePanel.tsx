import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWriteContract } from 'wagmi'
import { Anchor, FileText, Paperclip } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime } from '@/lib/format'
import { FILE_ACCEPT, mimeForFilename } from '@/shared/files'
import { openProtectedFile } from '@/lib/attachments'
import type { EvidenceFile } from '@/lib/types'
import { ChainAction } from './ChainAction'

interface Props {
  publicId: string
  /** Chain id of the escrow, needed to anchor a hash. Omit for a read-only list (admin console). */
  onChainId?: string
  /** Parties may upload while the case is open. */
  canUpload: boolean
  /** Parties may anchor a hash onchain from their own wallet. */
  canAnchor: boolean
}

interface EvidenceResponse {
  files: EvidenceFile[]
  maxBytes: number
  mimeTypes: string[]
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 100 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Evidence files for an open case. The file stays offchain; its hash can be anchored onchain so it cannot be backdated. */
export function EvidencePanel({ publicId, onChainId, canUpload, canAnchor }: Props) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = ['evidence', publicId]
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<EvidenceResponse>(`/transactions/${publicId}/evidence`),
    refetchInterval: 8000,
  })
  const files = list.data?.files ?? []
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
        body: { filename: file.name, mime: mimeForFilename(file.name) ?? 'text/plain', note: note.trim() || undefined, dataBase64: toBase64(await file.arrayBuffer()) },
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

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="display flex items-center gap-2 text-lg font-semibold">
          <Paperclip className="size-4" /> {tr('Bằng chứng', 'Evidence')}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {tr(
            'Chỉ hai bên và Admin xem được tệp. Bạn có thể ghi mã băm của tệp lên chuỗi để chứng minh tệp tồn tại từ thời điểm đó.',
            'Only the two parties and the Admin can open the files. You can anchor a file hash onchain to prove the file existed at that time.',
          )}
        </p>
      </div>

      {canUpload && (
        <div className="inner space-y-2 p-3">
          <input className="field" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Ghi chú cho tệp (không bắt buộc)', 'Note for the file (optional)')} />
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
          <p className="text-xs text-[var(--muted)]">{tr(`PNG, JPEG, WebP, PDF hoặc văn bản, tối đa ${sizeLabel(maxBytes)}.`, `PNG, JPEG, WebP, PDF or plain text, up to ${sizeLabel(maxBytes)}.`)}</p>
          {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
        </div>
      )}

      {list.isLoading ? null : files.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{tr('Chưa có bằng chứng nào.', 'No evidence yet.')}</p>
      ) : (
        <ul className="space-y-3">
          {files.map((f) => (
            <li key={f.id} className="inner space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
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
                <span className="chip">{f.uploadedBy === 'buyer' ? 'Buyer' : 'Seller'}</span>
              </div>
              <div className="text-xs text-[var(--muted)]">
                {sizeLabel(f.size)} · {formatDateTime(f.createdAt, lang)}
              </div>
              {f.note && <p className="whitespace-pre-wrap break-words text-[var(--ink-2)]">{f.note}</p>}
              {f.scan?.verdict === 'warn' && (
                <p className="rounded-lg bg-[#fff4d6] p-2 text-xs text-[var(--warn)]">{tr('Cảnh báo từ kiểm tra cơ bản', 'Basic check warning')}: {f.scan.reasons.join('; ')}</p>
              )}
              <div className="mono break-all text-[10px] text-[var(--subtle)]">sha256 {f.sha256}</div>
              {f.anchored ? (
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
                  <Anchor className="size-3.5" /> {tr('Đã ghi lên chuỗi lúc', 'Anchored onchain at')} {formatDateTime(f.anchored.at, lang)}
                </p>
              ) : (
                canAnchor &&
                onChainId && (
                  <ChainAction
                    label={tr('Ghi mã băm lên chuỗi', 'Anchor hash onchain')}
                    variant="ghost"
                    send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'anchorEvidence', args: [BigInt(onChainId), f.sha256 as `0x${string}`], chainId: CHAIN_ID })}
                    onDone={() => qc.invalidateQueries({ queryKey: key })}
                  />
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
