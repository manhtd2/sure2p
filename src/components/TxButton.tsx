import { CheckCircle2, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { useLang } from '@/i18n'
import { CHAIN_ID } from '@/lib/contracts'
import type { TxState } from '@/hooks/useTx'

interface Props {
  label: string
  onClick: () => void
  state: TxState
  disabled?: boolean
  variant?: 'primary' | 'ghost' | 'danger'
  hint?: string
}

/** One wallet action with honest states: signature, pending, confirmed only after the real receipt. */
export function TxButton({ label, onClick, state, disabled, variant = 'primary', hint }: Props) {
  const { tr } = useLang()
  const busy = state.phase === 'awaiting_signature' || state.phase === 'pending'
  return (
    <div className="space-y-2">
      <button type="button" onClick={onClick} disabled={disabled || busy} className={`btn btn-${variant} w-full`}>
        {state.phase === 'awaiting_signature' ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {tr('Xác nhận trong ví...', 'Confirm in wallet...')}
          </>
        ) : state.phase === 'pending' ? (
          <>
            <Loader2 className="size-4 animate-spin" /> {tr('Đang chờ xác nhận trên chuỗi...', 'Waiting for onchain confirmation...')}
          </>
        ) : (
          label
        )}
      </button>
      {hint && state.phase === 'idle' && <p className="text-xs text-[var(--muted)]">{hint}</p>}
      {state.phase === 'confirmed' && state.hash && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--success)]">
          <CheckCircle2 className="size-3.5" /> {tr('Đã xác nhận', 'Confirmed')}
          <a
            href={buildTxExplorerUrl(CHAIN_ID, state.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1 underline"
          >
            Explorer <ExternalLink className="size-3" />
          </a>
        </p>
      )}
      {(state.phase === 'failed' || state.phase === 'rejected') && state.error && (
        <p
          className={`flex items-start gap-1.5 text-xs ${state.phase === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--muted)]'}`}
          role="alert"
        >
          {state.phase === 'failed' && <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}
          {state.error}
        </p>
      )}
    </div>
  )
}
