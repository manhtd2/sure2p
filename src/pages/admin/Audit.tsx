import { useQuery } from '@tanstack/react-query'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { formatDateTime, shortAddress } from '@/lib/format'
import { Loader } from '@/components/Loader'

interface AuditData {
  events: Array<{ name: string; publicId: string | null; blockNumber: number; timestamp: number; txHash: string; args: Record<string, string> }>
  actions: Array<{ at: number; action: string; subject: string | null; detail: string | null }>
}

/** Read-only history: rulings and role changes from the chain, and admin account actions from the server. */
export default function AdminAudit() {
  const { tr, lang } = useLang()
  const q = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<AuditData>('/admin/audit'), refetchInterval: 15_000 })
  if (q.isLoading || !q.data) return <Loader />
  const { events, actions } = q.data
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl font-bold">{tr('Nhật ký', 'Audit log')}</h1>
      <section className="card p-5">
        <h2 className="display text-lg font-bold">{tr('Sự kiện phán quyết và vai trò (từ chuỗi)', 'Ruling and role events (onchain)')}</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{tr('Chưa có sự kiện nào.', 'No events yet.')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {events.map((e) => (
              <li key={`${e.txHash}-${e.name}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{e.name}</strong>{e.publicId ? <span className="mono ml-2 text-xs text-[var(--muted)]">{e.publicId}</span> : null}{e.args.issuedBy ? <span className="mono ml-2 text-xs">{shortAddress(e.args.issuedBy)}</span> : null}</span>
                <a className="mono text-xs underline" href={`https://explorer.testnet.arc.io/tx/${e.txHash}`} target="_blank" rel="noreferrer">{formatDateTime(e.timestamp, lang)} · #{e.blockNumber}</a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-5">
        <h2 className="display text-lg font-bold">{tr('Hành động quản trị trên tài khoản (từ máy chủ)', 'Admin account actions (server)')}</h2>
        {actions.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">{tr('Chưa có hành động nào.', 'No actions yet.')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {actions.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span><strong>{a.action}</strong> <span className="mono text-xs text-[var(--muted)]">{a.subject}</span></span>
                <span className="text-xs text-[var(--muted)]">{formatDateTime(a.at, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-[var(--muted)]">{tr('Nhật ký này chỉ đọc. Lý do phán quyết nằm trong từng hồ sơ.', 'This log is read-only. Ruling reasons live inside each case.')}</p>
    </div>
  )
}
