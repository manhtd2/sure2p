import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2 } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'

interface Props {
  draftId: string
  onDeleted: () => void
}

/** Two-step delete for a draft nobody has joined yet. Never touches an agreement that already has a counterparty. */
export function DeleteDraftButton({ draftId, onDeleted }: Props) {
  const { tr } = useLang()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api(`/drafts/${draftId}?action=delete`, { body: {} })
      qc.removeQueries({ queryKey: ['draft', draftId] })
      await qc.invalidateQueries({ queryKey: ['transactions'] })
      onDeleted()
    } catch (e) {
      setError(errorText(e, tr))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#fde8ec] p-3 text-sm">
          <span className="text-[var(--danger)]">{tr('Xóa bản nháp và lời mời này? Link, mã và QR đã gửi sẽ không dùng được nữa.', 'Delete this draft and its invitation? The link, code and QR you shared will stop working.')}</span>
          <button type="button" className="btn btn-danger !min-h-9 !px-3 text-xs" disabled={busy} onClick={() => void remove()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} {tr('Xóa', 'Delete')}
          </button>
          <button type="button" className="btn btn-ghost !min-h-9 !px-3 text-xs" disabled={busy} onClick={() => setConfirming(false)}>
            {tr('Hủy', 'Cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost !min-h-9 !px-3 text-xs text-[var(--danger)]" onClick={() => setConfirming(true)}>
          <Trash2 className="size-3.5" /> {tr('Xóa bản nháp', 'Delete draft')}
        </button>
      )}
      {error && <p className="text-xs text-[var(--danger)]" role="alert">{error}</p>}
    </div>
  )
}
