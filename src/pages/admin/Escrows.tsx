import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { usdcWithCommas } from '@/lib/format'
import { Loader } from '@/components/Loader'

interface Trust {
  snapshot: { ok: boolean; blockNumber?: string }
  reserves: { status: 'covered' | 'shortfall' | 'unknown'; usdcHeld?: string; obligations?: string; surplus?: string; shortfall?: string }
  claims?: { pending: string; penaltyPending: string }
  escrowCount?: string
}

/** Escrow supervision: what the contract holds against what it owes, read at one block (same figures as /trust). */
export default function AdminEscrows() {
  const { tr } = useLang()
  const q = useQuery({ queryKey: ['trust'], queryFn: () => api<Trust>('/trust'), refetchInterval: 15_000 })
  if (q.isLoading || !q.data) return <Loader />
  const d = q.data
  const ok = d.snapshot.ok
  const cells: Array<[string, string | undefined]> = [
    [tr('USDC hợp đồng đang giữ', 'USDC held'), d.reserves.usdcHeld],
    [tr('Nghĩa vụ (khóa + chờ nhận)', 'Obligations (locked + pending)'), d.reserves.obligations],
    [tr('Tổng chờ nhận', 'Pending claims'), d.claims?.pending],
    [tr('Trong đó ví phạt', 'Of which penalty wallet'), d.claims?.penaltyPending],
  ]
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl font-bold">{tr('Giám sát ký quỹ', 'Escrow supervision')}</h1>
      {!ok && <p className="card p-4 text-sm text-[var(--warn)]" role="alert">{tr('Không đọc được chuỗi lúc này: các số bên dưới là Chưa rõ.', 'The chain cannot be read right now: figures below are Unknown.')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {cells.map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="label">{k}</p>
            <p className="display text-2xl font-bold tabular-nums">{ok && v !== undefined ? `${usdcWithCommas(v)} USDC` : tr('Chưa rõ', 'Unknown')}</p>
          </div>
        ))}
      </div>
      <p className="card p-4 text-sm">
        {d.reserves.status === 'covered' && tr('Số dư lớn hơn hoặc bằng nghĩa vụ ở cùng một khối.', 'The balance covers the obligations at one block.')}
        {d.reserves.status === 'shortfall' && <strong className="text-[var(--danger)]">{tr('THIẾU: số dư thấp hơn nghĩa vụ. Dừng và điều tra.', 'SHORTFALL: balance is below obligations. Stop and investigate.')}</strong>}
        {d.reserves.status === 'unknown' && tr('Không kiểm chứng được khả năng chi trả.', 'Solvency cannot be verified.')}
      </p>
      <Link to="/trust" className="text-sm font-semibold underline">{tr('Xem trang Tin cậy công khai', 'Open the public Trust page')}</Link>
    </div>
  )
}
