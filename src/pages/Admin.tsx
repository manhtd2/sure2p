import { useQuery, useQueryClient } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { useWriteContract } from 'wagmi'
import { ArrowLeft, Gavel } from 'lucide-react'
import { ChainAction } from '@/components/ChainAction'
import { DecisionSummary } from '@/components/RulingPanel'
import { EvidencePanel } from '@/components/EvidencePanel'
import { DeliveryProofPanel } from '@/components/DeliveryProofPanel'
import { HistoryList } from '@/components/HistoryList'
import { AttachmentList } from '@/components/AttachmentList'
import { PenaltyPanel } from '@/components/PenaltyPanel'
import { Loader } from '@/components/Loader'
import { RulingForm } from '@/components/RulingForm'
import { StageLabel } from '@/components/StageChip'
import { useNow } from '@/hooks/useNow'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime, formatDuration, shortAddress, usdcWithCommas } from '@/lib/format'
import type { AdminCase, RulingView } from '@/lib/types'

interface CaseItem {
  publicId: string
  title: string | null
  stage: string
  price: string
  buyerWallet: string
  sellerWallet: string
  needsFlag: boolean
  actionable: boolean
  ruling: RulingView | null
}

export interface AdminMe {
  role: 'arbiter' | 'reviewer' | null
  penaltyWallet: boolean
  security: boolean
}

/** Admin console shell. Access is decided by the chain: arbiter, appeal reviewer, security admin or penalty wallet. */
export default function Admin() {
  const { tr } = useLang()
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => api<AdminMe>('/admin/me') })

  if (me.isLoading) return <Loader />
  if (me.error) return <p className="card p-6 text-sm text-[var(--danger)]">{errorText(me.error, tr)}</p>
  const m = me.data
  if (!m?.role && !m?.security && m?.penaltyWallet) {
    return (
      <div className="space-y-5">
        <div>
          <span className="chip">{tr('Ví penalty', 'Penalty wallet')}</span>
          <h1 className="display mt-2 text-3xl font-bold">{tr('Nhận tiền phạt', 'Claim penalties')}</h1>
        </div>
        <PenaltyPanel />
      </div>
    )
  }
  if (!m?.role && !m?.security) {
    return (
      <section className="card space-y-2 p-6">
        <h1 className="display text-2xl font-bold">{tr('Admin console', 'Admin console')}</h1>
        <p className="text-sm text-[var(--muted)]">
          {tr(
            'Ví bạn đang đăng nhập không phải Arbiter, Appeal Reviewer, quản trị bảo mật hay ví penalty của hợp đồng. Hãy đăng nhập bằng đúng ví được giao vai trò.',
            'The wallet you are signed in with is not the contract\'s Arbiter, Appeal Reviewer, security admin or penalty wallet. Sign in with the wallet that holds the role.',
          )}
        </p>
      </section>
    )
  }
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-xl px-3 py-2 text-sm font-medium ${isActive ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border)] pb-3" aria-label={tr('Mục quản trị', 'Admin sections')}>
        <NavLink end to="/admin" className={tab}>{tr('Tổng quan', 'Overview')}</NavLink>
        <NavLink to="/admin/cases" className={tab}>{tr('Hồ sơ', 'Cases')}</NavLink>
        <NavLink to="/admin/appeals" className={tab}>{tr('Kháng cáo', 'Appeals')}</NavLink>
        <NavLink to="/admin/escrows" className={tab}>{tr('Ký quỹ', 'Escrows')}</NavLink>
        <NavLink to="/admin/accounts" className={tab}>{tr('Tài khoản', 'Accounts')}</NavLink>
        <NavLink to="/admin/audit" className={tab}>{tr('Nhật ký', 'Audit')}</NavLink>
        <NavLink to="/admin/settings" className={tab}>{tr('Cài đặt', 'Settings')}</NavLink>
        {m?.penaltyWallet && <NavLink to="/admin/penalty" className={tab}>{tr('Tiền phạt', 'Penalties')}</NavLink>}
      </nav>
      <Outlet context={m} />
    </div>
  )
}

/** All open cases, or only the appeal queue for the Appeal Reviewer. */
export function CasesPage({ appealsOnly = false }: { appealsOnly?: boolean }) {
  const { tr } = useLang()
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ['admin-me'], queryFn: () => api<AdminMe>('/admin/me') }).data
  if (!me?.role) {
    return <p className="card p-6 text-sm text-[var(--muted)]">{tr('Chỉ Arbiter và Appeal Reviewer xem được hồ sơ tranh chấp.', 'Only the Arbiter and the Appeal Reviewer can see dispute cases.')}</p>
  }
  return <CaseList role={me.role} appealsOnly={appealsOnly} onOpen={(id) => void navigate(`/admin/cases/${id}`)} />
}

function CaseList({ role, onOpen, appealsOnly }: { role: 'arbiter' | 'reviewer'; onOpen: (id: string) => void; appealsOnly: boolean }) {
  const { tr } = useLang()
  const list = useQuery({
    queryKey: ['admin-cases'],
    queryFn: () => api<{ role: string; items: CaseItem[] }>('/admin/cases'),
    refetchInterval: 8000,
  })
  const all = list.data?.items ?? []
  const items = appealsOnly ? all.filter((c) => c.stage === 'appealed') : all
  return (
    <div className="space-y-5">
      <div>
        <span className="chip">{role === 'arbiter' ? 'Arbiter' : 'Appeal Reviewer'}</span>
        <h1 className="display mt-2 flex items-center gap-2 text-3xl font-bold"><Gavel className="size-6" /> {appealsOnly ? tr('Hàng đợi kháng cáo', 'Appeal queue') : tr('Các vụ đang mở', 'Open cases')}</h1>
        <p className="text-sm text-[var(--muted)]">
          {role === 'arbiter'
            ? tr('Bạn ra phán quyết sơ bộ cho các vụ quá hạn hoặc tranh chấp.', 'You issue preliminary rulings on overdue or disputed deals.')
            : tr('Bạn ra phán quyết cuối cùng cho các vụ bị kháng cáo.', 'You issue the final ruling on appealed deals.')}
        </p>
      </div>
      {list.isLoading ? <Loader /> : items.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--muted)]">{tr('Không có vụ nào đang mở.', 'No open cases.')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <li key={c.publicId}>
              <button type="button" onClick={() => onOpen(c.publicId)} className="card flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left">
                <div className="space-y-1">
                  <div className="font-semibold">{c.title ?? tr('Giao dịch', 'Transaction')}</div>
                  <div className="mono text-xs text-[var(--muted)]">{c.publicId} · {usdcWithCommas(c.price)} USDC</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.actionable && <span className="chip !bg-[#fff4d6] !text-[var(--warn)]">{tr('Cần bạn xử lý', 'Needs you')}</span>}
                  {c.needsFlag ? <span className="chip">{tr('Quá hạn, chưa đánh dấu', 'Overdue, not flagged')}</span> : <StageLabel stage={c.stage} />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CaseDetailPage() {
  const { publicId = '' } = useParams()
  const navigate = useNavigate()
  const onBack = () => void navigate('/admin/cases')
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const now = useNow()
  const { writeContractAsync } = useWriteContract()
  const key = ['admin-case', publicId]
  const q = useQuery({ queryKey: key, queryFn: () => api<AdminCase>(`/admin/cases/${publicId}`), refetchInterval: 5000 })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key })
    void qc.invalidateQueries({ queryKey: ['admin-cases'] })
    void qc.invalidateQueries({ queryKey: ['evidence', publicId] })
  }
  if (q.error) return <p className="card p-6 text-sm text-[var(--danger)]">{errorText(q.error, tr)}</p>
  if (!q.data) return <Loader />
  const v = q.data
  const id = BigInt(v.onChainId)
  const prelim = v.ruling?.prelim ?? null
  const canPrelim = v.role === 'arbiter' && (v.stage === 'overdue' || v.stage === 'disputed')
  const canFinal = v.role === 'reviewer' && v.stage === 'appealed'
  const waitingAppeal = v.stage === 'preliminary_ruling' && prelim !== null
  const remaining = prelim ? prelim.appealDeadline - now : 0

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="btn btn-ghost !min-h-9 !px-3 text-xs"><ArrowLeft className="size-3.5" /> {tr('Danh sách', 'All cases')}</button>
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StageLabel stage={v.stage} />
          <span className="chip mono">{v.publicId}</span>
        </div>
        <h1 className="display text-3xl font-bold">{v.terms?.title ?? tr('Giao dịch', 'Transaction')}</h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {v.stage === 'active' && (
            <section className="card space-y-2 p-5">
              <p className="text-sm text-[var(--ink-2)]">{tr('Giao dịch đã quá hạn nhưng chưa ai đánh dấu. Cần đánh dấu quá hạn trước khi Arbiter ra phán quyết. Ai cũng gọi được.', 'This deal is past a deadline but nobody has flagged it. It must be flagged overdue before the Arbiter can rule. Anyone can do this.')}</p>
              <ChainAction label={tr('Đánh dấu quá hạn', 'Flag overdue')} send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'flagOverdue', args: [id], chainId: CHAIN_ID })} onDone={refresh} />
            </section>
          )}

          {canPrelim && <RulingForm view={v} kind="prelim" onDone={refresh} />}
          {canFinal && (
            <>
              {v.ruling?.appeal && (
                <section className="card space-y-2 p-5">
                  <h2 className="display text-lg font-semibold">{tr('Lý do kháng cáo', 'Appeal reason')}</h2>
                  <p className="whitespace-pre-wrap break-words text-sm">{v.ruling.notes[v.ruling.appeal.reasonHash] ?? v.ruling.appeal.reasonHash}</p>
                  <p className="text-xs text-[var(--muted)]">{tr('Kháng cáo bởi', 'Appealed by')} <span className="mono">{shortAddress(v.ruling.appeal.by)}</span></p>
                </section>
              )}
              <RulingForm view={v} kind="final" onDone={refresh} />
            </>
          )}
          {waitingAppeal && prelim && (
            <section className="card space-y-3 p-5">
              <h2 className="display text-lg font-semibold">{tr('Phán quyết sơ bộ', 'Preliminary ruling')}</h2>
              <DecisionSummary view={v} decision={prelim} reason={v.ruling?.notes[prelim.reasonHash]} />
              {remaining >= 0 ? (
                <p className="text-sm text-[var(--muted)]">{tr(`Còn ${formatDuration(remaining, lang)} để kháng cáo (đến ${formatDateTime(prelim.appealDeadline, lang)}).`, `${formatDuration(remaining, lang)} left to appeal (until ${formatDateTime(prelim.appealDeadline, lang)}).`)}</p>
              ) : (
                <ChainAction label={tr('Chốt phán quyết', 'Finalize ruling')} send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'finalizeRuling', args: [id], chainId: CHAIN_ID })} onDone={refresh} />
              )}
            </section>
          )}
          {v.stage === 'ruled' && v.ruling?.final && (
            <section className="card space-y-3 p-5">
              <h2 className="display text-lg font-semibold">{tr('Phán quyết cuối cùng', 'Final ruling')}</h2>
              <DecisionSummary view={v} decision={v.ruling.final} reason={v.ruling.notes[v.ruling.final.reasonHash]} />
            </section>
          )}
          {v.stage === 'appealed' && v.role === 'arbiter' && (
            <p className="card p-5 text-sm text-[var(--muted)]">{tr('Vụ này đã bị kháng cáo. Appeal Reviewer sẽ ra phán quyết cuối cùng.', 'This case was appealed. The Appeal Reviewer will issue the final ruling.')}</p>
          )}

          <DeliveryProofPanel publicId={v.publicId} viewer="admin" canUpload={false} hideWhenEmpty />
          <EvidencePanel publicId={v.publicId} canUpload={false} canAnchor={false} />
          <section className="card space-y-3 p-5">
            <h2 className="display text-lg font-semibold">{tr('Lịch sử trên chuỗi', 'Onchain history')}</h2>
            <HistoryList events={v.history} />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card space-y-2 p-5 text-sm">
            <div className="label">{tr('Số tiền', 'Amounts')}</div>
            <div className="flex justify-between"><span>{tr('Giá', 'Price')}</span><span className="tabular-nums font-semibold">{usdcWithCommas(v.price)} USDC</span></div>
            <div className="flex justify-between"><span>{tr('Cọc Buyer', 'Buyer deposit')}</span><span className="tabular-nums">{usdcWithCommas(v.buyerDeposit)} USDC</span></div>
            <div className="flex justify-between"><span>{tr('Cọc Seller', 'Seller deposit')}</span><span className="tabular-nums">{usdcWithCommas(v.sellerDeposit)} USDC</span></div>
          </section>
          <section className="card space-y-2 p-5 text-xs text-[var(--muted)]">
            <div className="label">{tr('Các bên', 'Parties')}</div>
            <div>Buyer <span className="mono break-all">{v.buyerWallet}</span></div>
            <div>Seller <span className="mono break-all">{v.sellerWallet}</span></div>
            {v.disputeOpenedBy && <div>{tr('Tranh chấp mở bởi', 'Dispute opened by')} <span className="mono">{shortAddress(v.disputeOpenedBy)}</span></div>}
          </section>
          {v.terms && (
            <section className="card space-y-2 p-5 text-sm">
              <div className="label">{tr('Điều khoản đã ký', 'Signed terms')}</div>
              <p className="whitespace-pre-wrap break-words text-[var(--ink-2)]">{v.terms.description}</p>
              <p className="text-xs text-[var(--muted)]">{tr('Tiêu chí nghiệm thu', 'Acceptance criteria')}: {v.terms.acceptanceCriteria}</p>
              {(v.terms.attachments?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="label">{tr('Tài liệu mô tả hàng của Buyer (đối chiếu với hàng thực nhận)', "Buyer's description files (compare with the goods received)")}</div>
                  <AttachmentList files={v.terms.attachments!} href={(sha) => `/api/transactions/${v.publicId}/evidence?attachment=${sha}`} lock="evidence" />
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
