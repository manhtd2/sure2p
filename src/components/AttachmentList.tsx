import { FileText, Lock, ShieldAlert } from 'lucide-react'
import { useLang } from '@/i18n'
import { toast } from 'sonner'
import { errorText } from '@/lib/api'
import { formatBytes, openProtectedFile } from '@/lib/attachments'
import type { AttachmentRef } from '@/shared/protocol'

interface Props {
  files: AttachmentRef[]
  /** Where to download one file. Omit to list without links. */
  href?: (sha256: string) => string
  /** 'signed' = locked by both signatures. 'evidence' = escrow created, kept as evidence for a dispute. */
  lock?: 'signed' | 'evidence'
  /** Hashes whose bytes are not uploaded yet. */
  missing?: string[]
}

/** The Buyer's description files with their hashes. The same hashes sit inside the signed agreement hash. */
export function AttachmentList({ files, href, lock, missing = [] }: Props) {
  const { tr } = useLang()
  if (files.length === 0) return null
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {files.map((f) => {
          const absent = missing.includes(f.sha256)
          return (
            <li key={f.sha256} className="inner flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0" />
                {href && !absent ? (
                  <a
                    className="truncate font-semibold underline"
                    href={href(f.sha256)}
                    download={f.name}
                    onClick={(e) => {
                      e.preventDefault()
                      openProtectedFile(href(f.sha256), f.name).catch((err) => toast.error(errorText(err, tr)))
                    }}
                  >
                    {f.name}
                  </a>
                ) : (
                  <span className="truncate font-semibold">{f.name}</span>
                )}
                <span className="shrink-0 text-xs text-[var(--muted)]">{formatBytes(f.size)}</span>
              </span>
              <span className="mono text-xs text-[var(--subtle)]" title={f.sha256}>sha256 {f.sha256.slice(0, 10)}...{f.sha256.slice(-6)}</span>
              {absent && (
                <span className="flex w-full items-center gap-1 text-xs text-[var(--danger)]"><ShieldAlert className="size-3.5" /> {tr('File chưa được tải lên đầy đủ.', 'This file has not been fully uploaded.')}</span>
              )}
            </li>
          )
        })}
      </ul>
      {lock && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--muted)]">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          {lock === 'evidence'
            ? tr('Đã khóa làm bằng chứng. Mã băm của các file này nằm trong chữ ký thỏa thuận và đã ghi lên chuỗi khi tạo escrow, nên không thể thay đổi. Dùng để đối chiếu khi có tranh chấp.', 'Locked as evidence. These files\' hashes are inside the signed agreement and were recorded onchain when the escrow was created, so they cannot change. Use them to compare against the goods if a dispute arises.')
            : tr('Đã khóa theo chữ ký: mã băm các file nằm trong thỏa thuận hai bên đã ký.', 'Locked by signature: the hashes of these files are inside the agreement both sides signed.')}
        </p>
      )}
      <p className="text-xs text-[var(--subtle)]">{tr('Chỉ mở file Excel, Word hoặc PDF từ nguồn bạn tin cậy.', 'Only open Excel, Word or PDF files from sources you trust.')}</p>
    </div>
  )
}
