import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi } from 'viem'
import { useWriteContract } from 'wagmi'
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, escrowAbi } from '@/lib/contracts'
import { useNow } from '@/hooks/useNow'
import { ChainAction } from './ChainAction'
import { InviteShare } from './InviteShare'

export interface PreviewData {
  tool: string
  title: string
  lines: string[]
  amounts: Array<{ label: string; value: string }>
  warnings: string[]
  effect: { type: 'server_write' | 'wallet_call' }
  next?: { label: string; to: string }
}

interface PreviewResponse {
  id: string
  status: 'ready' | 'confirmed' | 'cancelled' | 'stale' | 'expired'
  expiresAt: number
  preview: PreviewData
}

interface Step {
  to: 'escrow' | 'usdc'
  functionName: string
  args: string[]
  label: string
}

type Confirmed =
  | { status: 'done'; kind: 'draft' | 'invitation' | 'version' | 'settlement'; result: Record<string, unknown>; next: { label: string; to: string } | null }
  | { status: 'sign'; steps: Step[]; escrow: `0x${string}`; usdc: `0x${string}`; next: { label: string; to: string } | null }

/** Strings from the server become the types the contract expects: numbers as bigint, addresses and hashes as hex. */
function arg(v: string): `0x${string}` | bigint {
  return /^\d+$/.test(v) ? BigInt(v) : (v as `0x${string}`)
}

function WalletSteps({ steps, escrow, usdc, next }: { steps: Step[]; escrow: `0x${string}`; usdc: `0x${string}`; next: Confirmed['next'] }) {
  const { tr } = useLang()
  const { writeContractAsync } = useWriteContract()
  const [done, setDone] = useState(0)
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-2)]">{tr('Chưa có gì được gửi. Mỗi bước dưới đây cần ví của bạn ký.', 'Nothing has been sent. Each step below needs your wallet to sign.')}</p>
      {steps.map((s, i) => (
        <div key={`${s.functionName}-${i}`} className="inner space-y-2 p-3">
          <p className="text-sm font-semibold">{i + 1}. {s.label}</p>
          {i < done ? (
            <p className="text-xs text-[var(--success)]">{tr('Đã xác nhận trên chuỗi.', 'Confirmed onchain.')}</p>
          ) : (
            <ChainAction
              label={s.label}
              disabled={i !== done}
              hint={i !== done ? tr('Làm bước trước trước.', 'Do the previous step first.') : undefined}
              send={() =>
                s.to === 'usdc'
                  ? writeContractAsync({ address: usdc, abi: erc20Abi, functionName: 'approve', args: [s.args[0] as `0x${string}`, BigInt(s.args[1])], chainId: CHAIN_ID })
                  : (writeContractAsync({ address: escrow, abi: escrowAbi, functionName: s.functionName as never, args: s.args.map(arg), chainId: CHAIN_ID }))
              }
              onDone={() => setDone((n) => Math.max(n, i + 1))}
            />
          )}
        </div>
      ))}
      {done >= steps.length && next && <Link to={next.to} className="btn btn-primary">{next.label}</Link>}
    </div>
  )
}

/**
 * One prepared action. It is only a preview: it lives 300 seconds, does nothing until you press Continue, and a wallet
 * call still needs your wallet to sign every step.
 */
export function ActionPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { tr } = useLang()
  const qc = useQueryClient()
  const now = useNow()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Confirmed | null>(null)
  const q = useQuery({ queryKey: ['action-preview', id], queryFn: () => api<PreviewResponse>(`/actions?id=${id}`), refetchInterval: false })
  if (!q.data) return q.error ? <p className="text-sm text-[var(--danger)]">{errorText(q.error, tr)}</p> : null
  const p = q.data.preview
  const left = q.data.expiresAt - now
  const live = q.data.status === 'ready' && left > 0 && !result

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      setResult(await api<Confirmed>(`/actions?op=confirm&id=${id}`, { body: {} }))
      void qc.invalidateQueries({ queryKey: ['transactions'] })
    } catch (e) {
      setError(errorText(e, tr))
      void qc.invalidateQueries({ queryKey: ['action-preview', id] })
    } finally {
      setBusy(false)
    }
  }
  async function cancel() {
    await api(`/actions?op=cancel&id=${id}`, { body: {} }).catch(() => undefined)
    onClose()
  }

  return (
    <section className="card space-y-3 p-5" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="chip"><ShieldCheck className="size-3.5" /> {tr('Bản xem trước. Chưa làm gì cả.', 'Preview. Nothing has been done.')}</span>
        {live ? (
          <span className="chip" role="timer"><Clock className="size-3.5" /> {tr(`Còn ${Math.max(left, 0)} giây`, `${Math.max(left, 0)} s left`)}</span>
        ) : (
          !result && <span className="chip !bg-[#fde8ec] !text-[var(--danger)]">{q.data.status === 'ready' ? tr('Hết hạn', 'Expired') : q.data.status}</span>
        )}
      </div>
      <h3 className="display text-lg font-bold">{p.title}</h3>
      {p.lines.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ink-2)]">{p.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {p.amounts.length > 0 && (
        <dl className="inner divide-y divide-[var(--border)] text-sm">
          {p.amounts.map((a) => (
            <div key={a.label} className="flex justify-between gap-3 p-2.5"><dt>{a.label}</dt><dd className="tabular-nums font-semibold">{a.value}</dd></div>
          ))}
        </dl>
      )}
      {p.warnings.map((w) => (
        <p key={w} className="flex items-start gap-2 rounded-xl bg-[#fff4d6] p-3 text-xs text-[var(--warn)]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}</p>
      ))}
      {error && <p className="text-sm text-[var(--danger)]" role="alert">{error}</p>}

      {!result && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={!live || busy} onClick={() => void confirm()}>
            {p.effect.type === 'wallet_call' ? tr('Tiếp tục tới ví', 'Continue to wallet') : tr('Tiếp tục và thực hiện', 'Continue and do it')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{tr('Sửa', 'Edit')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => void cancel()}>{tr('Hủy', 'Cancel')}</button>
        </div>
      )}
      {result?.status === 'done' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-[var(--success)]">{tr('Đã thực hiện trên máy chủ.', 'Done on the server.')}</p>
          {result.kind === 'invitation' && <InviteShare token={String(result.result.token)} code={String(result.result.code)} expiresAt={Number(result.result.expiresAt)} />}
          {result.kind === 'draft' && <Link to={`/transactions/${String(result.result.id)}`} className="btn btn-primary">{tr('Mở bản nháp', 'Open the draft')}</Link>}
          {result.kind !== 'draft' && result.next && <Link to={result.next.to} className="btn btn-primary">{result.next.label}</Link>}
        </div>
      )}
      {result?.status === 'sign' && <WalletSteps steps={result.steps} escrow={result.escrow} usdc={result.usdc} next={result.next} />}
    </section>
  )
}
