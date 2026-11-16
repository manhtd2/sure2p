import { useParams } from 'react-router-dom'
import { DraftPanel } from '@/components/DraftPanel'
import { EscrowPanel } from '@/components/EscrowPanel'
import { isPublicId } from '@/shared/protocol'
import { useLang } from '@/i18n'

const DRAFT_REF = /^d[0-9a-f]{20}$/

/** One route for both: an opaque draft reference before the escrow exists, the public ID after. */
export default function TransactionDetail() {
  const { ref = '' } = useParams()
  const { tr } = useLang()
  if (DRAFT_REF.test(ref)) return <DraftPanel draftId={ref} />
  if (isPublicId(ref)) return <EscrowPanel publicId={ref} />
  return <p className="card p-6 text-sm text-[var(--danger)]">{tr('Không tìm thấy giao dịch.', 'Transaction not found.')}</p>
}
