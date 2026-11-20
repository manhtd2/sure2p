import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleHelp, FlaskConical, TriangleAlert, XCircle } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'

interface Component {
  id: string
  state: 'ok' | 'down' | 'degraded' | 'unknown' | 'mock'
  ms?: number
  note?: string
  detail?: string
  blocksBehind?: number | null
  lastError?: string | null
}
interface StatusData {
  checkedAt: number
  components: Component[]
  monitoring: string
}

export default function Status() {
  const { tr } = useLang()
  const q = useQuery({ queryKey: ['status'], queryFn: () => api<StatusData>('/status'), refetchInterval: 20_000, retry: 1 })
  const names: Record<string, [string, string]> = {
    web: ['Giao diện ứng dụng', 'Web app'],
    api: ['Máy chủ API', 'API server'],
    rpc: ['Đầu gọi mạng (RPC)', 'Network RPC'],
    database: ['Cơ sở dữ liệu', 'Database'],
    indexer: ['Bộ quét sự kiện', 'Event indexer'],
    otp: ['Nhà cung cấp mã xác thực', 'OTP provider'],
    evidence: ['Kho bằng chứng', 'Evidence store'],
  }
  const label = (s: Component['state']) =>
    ({ ok: tr('Khỏe', 'Healthy'), down: tr('Không dùng được', 'Down'), degraded: tr('Suy giảm', 'Degraded'), unknown: tr('Chưa rõ', 'Unknown'), mock: tr('Mã giả (thử nghiệm)', 'Mock (test)') })[s]
  const Icon = (s: Component['state']) => (s === 'ok' ? CheckCircle2 : s === 'down' ? XCircle : s === 'degraded' ? TriangleAlert : s === 'mock' ? FlaskConical : CircleHelp)

  return (
    <div className="space-y-5">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Trạng thái', 'Status')}</h1>
        <p className="mt-2 max-w-3xl text-[var(--ink-2)]">
          {tr('Mỗi dòng là một đầu dò thật chạy lúc bạn mở trang. Chưa có giám sát liên tục, nên không có lịch sử thời gian hoạt động và không có chỉ báo xanh giả.', 'Each row is a real probe run when you open the page. There is no continuous monitoring yet, so no uptime history and no fake green lights.')}
        </p>
      </header>
      {q.isError && <div className="card p-4 text-sm text-[var(--danger)]" role="alert">{tr('Không gọi được máy chủ. Mọi trạng thái là Chưa rõ.', 'Server unreachable. Everything is Unknown.')}</div>}
      <div className="card divide-y divide-[var(--border)]">
        {(q.data?.components ?? []).map((c) => {
          const I = Icon(c.state)
          const tone = c.state === 'ok' ? 'text-[var(--success)]' : c.state === 'down' ? 'text-[var(--danger)]' : c.state === 'degraded' ? 'text-[var(--warn)]' : 'text-[var(--muted)]'
          return (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-semibold">{tr(...(names[c.id] ?? [c.id, c.id]))}</p>
                <p className="text-xs text-[var(--muted)]">
                  {c.ms !== undefined ? `${c.ms} ms · ` : ''}
                  {c.blocksBehind !== undefined && c.blocksBehind !== null ? `${tr('chậm', 'behind')} ${c.blocksBehind} ${tr('khối', 'blocks')} · ` : ''}
                  {c.note ?? c.detail ?? c.lastError ?? ''}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 text-sm font-semibold ${tone}`}><I className="size-4" aria-hidden />{label(c.state)}</span>
            </div>
          )
        })}
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="font-semibold">{tr('Giám sát liên tục', 'Continuous monitoring')}</p>
          <span className="text-sm font-semibold text-[var(--muted)]">{tr('Chưa cấu hình giám sát', 'Monitoring not configured')}</span>
        </div>
      </div>
      {q.data && <p className="text-xs text-[var(--muted)]">{tr('Kiểm tra lần cuối', 'Last checked')}: {new Date(q.data.checkedAt).toLocaleString()}</p>}
    </div>
  )
}
