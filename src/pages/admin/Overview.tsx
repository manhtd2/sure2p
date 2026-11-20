import { Link, useOutletContext } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { Loader } from '@/components/Loader'
import { StageLabel } from '@/components/StageChip'
import type { AdminMe } from '../Admin'

interface Overview {
  role: 'arbiter' | 'reviewer' | null
  security: boolean
  byStage: Record<string, number>
  activeNeedingFlag: number
  reconciliation: { ok: boolean; contractBalance: string; totalOutstanding: string; at: number } | null
  indexer: { blocksBehind: number | null; lastError: string | null }
}

export default function AdminOverview() {
  const { tr } = useLang()
  const me = useOutletContext<AdminMe>()
  const q = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview'), refetchInterval: 10_000 })
  if (q.isLoading || !q.data) return <Loader />
  const d = q.data
  const n = (k: string) => d.byStage[k] ?? 0
  const todo =
    me.role === 'arbiter' ? n('overdue') + n('disputed') + d.activeNeedingFlag : me.role === 'reviewer' ? n('appealed') : 0
  const stages = Object.entries(d.byStage).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl font-bold">{tr('Tổng quan', 'Overview')}</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Link to={me.role === 'reviewer' ? '/admin/appeals' : '/admin/cases'} className="card p-4">
          <p className="label">{tr('Cần bạn xử lý', 'Needs you')}</p>
          <p className="display text-3xl font-bold tabular-nums">{me.role ? todo : '—'}</p>
          {me.role === 'arbiter' && d.activeNeedingFlag > 0 && (
            <p className="text-xs text-[var(--warn)]">{tr(`${d.activeNeedingFlag} vụ quá hạn chưa được đánh dấu`, `${d.activeNeedingFlag} overdue deal(s) not flagged yet`)}</p>
          )}
        </Link>
        <div className="card p-4">
          <p className="label">{tr('Chờ kháng cáo hoặc chốt', 'Waiting for appeal or finalize')}</p>
          <p className="display text-3xl font-bold tabular-nums">{n('preliminary_ruling')}</p>
        </div>
        <div className="card p-4">
          <p className="label">{tr('Đối chiếu số dư', 'Reconciliation')}</p>
          <p className="font-semibold">
            {d.reconciliation ? (d.reconciliation.ok ? tr('Khớp', 'Balanced') : tr('LỆCH: số dư thấp hơn nghĩa vụ', 'MISMATCH: balance below obligations')) : tr('Chưa rõ', 'Unknown')}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {d.indexer.lastError ? d.indexer.lastError : d.indexer.blocksBehind !== null ? tr(`Bộ quét chậm ${d.indexer.blocksBehind} khối`, `Indexer ${d.indexer.blocksBehind} blocks behind`) : ''}
          </p>
        </div>
      </div>
      <section className="card p-5">
        <h2 className="display text-lg font-bold">{tr('Số giao dịch theo trạng thái', 'Deals by stage')}</h2>
        {stages.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{tr('Chưa có giao dịch nào trên hợp đồng này.', 'No deal exists on this contract yet.')}</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {stages.map(([stage, count]) => (
              <li key={stage} className="inner flex items-center justify-between p-3">
                <StageLabel stage={stage} />
                <span className="display text-xl font-bold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
