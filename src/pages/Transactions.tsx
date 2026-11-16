import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Clock, FilePlus2, Inbox, Loader2 } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { formatDateTime, formatDuration, usdcWithCommas } from '@/lib/format'
import type { ListItem } from '@/lib/types'
import { StageChip } from '@/components/StageChip'
import { useNow } from '@/hooks/useNow'

type RoleFilter = 'all' | 'buyer' | 'seller'
type StatusFilter = 'all' | 'pending' | 'funding' | 'active' | 'disputed' | 'completed' | 'expired'

function statusOf(item: ListItem): StatusFilter {
  if (item.kind === 'draft') return 'pending'
  switch (item.stage) {
    case 'funding':
      return 'funding'
    case 'active':
      return 'active'
    case 'disputed':
    case 'overdue':
      return 'disputed'
    case 'completed':
    case 'settled':
      return 'completed'
    case 'expired_unfunded':
      return 'expired'
    default:
      return 'pending'
  }
}

function matchesRole(role: RoleFilter, item: ListItem): boolean {
  return role === 'all' || item.myRole === role
}

function matchesStatus(status: StatusFilter, item: ListItem): boolean {
  return status === 'all' || statusOf(item) === status
}

/**
 * The one next step for this deal, derived from the same data the detail
 * page uses — no extra API call. `mine` marks steps that need *me* to act
 * (shown stronger); the rest are waiting on the counterparty.
 */
function nextStep(item: ListItem, tr: (vi: string, en: string) => string): { label: string; mine: boolean } | null {
  if (item.kind === 'draft') {
    switch (item.status) {
      case 'draft':
        return { label: tr('Mời đối tác tham gia', 'Invite the counterparty'), mine: true }
      case 'invited':
        return { label: tr('Chờ đối tác nhận lời mời', 'Waiting for the counterparty to join'), mine: false }
      case 'negotiating':
        return { label: tr('Xem điều khoản mới và ký', 'Review the new terms and sign'), mine: true }
      case 'ready':
        return { label: tr('Tạo escrow trên chuỗi', 'Create the escrow on-chain'), mine: true }
      case 'submitted':
        return { label: tr('Chờ lập chỉ mục escrow', 'Waiting for the escrow to be indexed'), mine: false }
      default:
        return null
    }
  }
  switch (item.stage) {
    case 'funding': {
      if (item.myRole === 'buyer' && !item.buyerFunded) {
        const total = BigInt(item.price) + BigInt(item.buyerDeposit)
        return { label: tr(`Nạp ${usdcWithCommas(total)} USDC (giá + cọc)`, `Fund ${usdcWithCommas(total)} USDC (price + deposit)`), mine: true }
      }
      if (item.myRole === 'seller' && !item.sellerFunded) {
        return { label: tr(`Nạp cọc ${usdcWithCommas(item.sellerDeposit)} USDC`, `Fund the ${usdcWithCommas(item.sellerDeposit)} USDC deposit`), mine: true }
      }
      return { label: tr('Chờ escrow kích hoạt', 'Waiting for the escrow to activate'), mine: false }
    }
    case 'active': {
      if (!item.sellerDeclaredAt) {
        return item.myRole === 'seller'
          ? { label: tr('Bàn giao hàng cho Buyer', 'Deliver the goods to the Buyer'), mine: true }
          : { label: tr('Chờ Seller bàn giao hàng', 'Waiting for the Seller to deliver'), mine: false }
      }
      if (!item.buyerAcknowledgedAt) {
        return item.myRole === 'buyer'
          ? { label: tr('Xác nhận đã nhận hàng', 'Confirm you received the goods'), mine: true }
          : { label: tr('Chờ Buyer xác nhận đã nhận', 'Waiting for the Buyer to confirm receipt'), mine: false }
      }
      if (!item.buyerAcceptedAt) {
        return item.myRole === 'buyer'
          ? { label: tr('Chấp nhận hàng để giải ngân', 'Accept the goods to release payment'), mine: true }
          : { label: tr('Chờ Buyer chấp nhận hàng', 'Waiting for the Buyer to accept'), mine: false }
      }
      return null
    }
    case 'overdue':
    case 'disputed':
      return { label: tr('Mở đề xuất dàn xếp chung', 'Open a mutual settlement proposal'), mine: true }
    case 'completed':
    case 'settled':
      return { label: tr('Xem và claim tiền của bạn', 'View and claim your funds'), mine: true }
    case 'expired_unfunded':
      return { label: tr('Đã hết hạn — tạo giao dịch mới', 'Expired — create a new transaction'), mine: false }
    default:
      return null
  }
}

/** The deadline that matters now for this deal, if any. */
function deadlineOf(item: ListItem): { label: string; at: number } | null {
  if (item.kind === 'draft') return null
  if (item.stage === 'funding') return { label: 'funding', at: item.fundingDeadline }
  if (item.stage === 'active') return { label: 'handover', at: item.handoverDeadline }
  if (item.stage === 'overdue' || item.stage === 'disputed') return { label: 'handover', at: item.handoverDeadline }
  return null
}

export default function Transactions() {
  const { tr, lang } = useLang()
  const now = useNow(30_000)
  const [role, setRole] = useState<RoleFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const { data, isLoading, error } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => api<{ items: ListItem[] }>('/transactions'),
    refetchInterval: 8000,
  })
  const items = data?.items ?? []

  const roleOptions: Array<[RoleFilter, string]> = [
    ['all', tr('Tất cả vai trò', 'All roles')],
    ['buyer', tr('Tôi là Buyer', 'I am Buyer')],
    ['seller', tr('Tôi là Seller', 'I am Seller')],
  ]
  const statusOptions: Array<[StatusFilter, string]> = [
    ['all', tr('Tất cả trạng thái', 'All statuses')],
    ['pending', tr('Chờ lời mời', 'Pending invitation')],
    ['funding', tr('Đang nạp tiền', 'Funding')],
    ['active', tr('Đang hoạt động', 'Active')],
    ['disputed', tr('Tranh chấp / quá hạn', 'Disputed / overdue')],
    ['completed', tr('Hoàn tất', 'Completed')],
    ['expired', tr('Hết hạn', 'Expired')],
  ]

  // Counts respect the other axis, so the numbers always match what you will see.
  const roleCounts = useMemo(
    () => Object.fromEntries(roleOptions.map(([r]) => [r, items.filter((i) => matchesStatus(status, i) && matchesRole(r, i)).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, status],
  )
  const statusCounts = useMemo(
    () => Object.fromEntries(statusOptions.map(([s]) => [s, items.filter((i) => matchesRole(role, i) && matchesStatus(s, i)).length])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, role],
  )
  const visible = items.filter((i) => matchesRole(role, i) && matchesStatus(status, i))

  return (
    <div className="tx-calm space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-bold">{tr('Giao dịch của tôi', 'My transactions')}</h1>
          <p className="text-sm text-[var(--muted)]">{tr('Số liệu lấy từ chuỗi và bộ lập chỉ mục.', 'Amounts come from the chain and the indexer.')}</p>
        </div>
        <Link to="/transactions/new" className="btn btn-primary">
          <FilePlus2 className="size-4" /> {tr('Tạo giao dịch', 'Create transaction')}
        </Link>
      </div>

      <div className="space-y-2" aria-label={tr('Lọc giao dịch', 'Filter transactions')}>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label={tr('Lọc theo vai trò', 'Filter by role')}>
          {roleOptions.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={role === id}
              onClick={() => setRole(id)}
              className={`btn !min-h-9 shrink-0 !px-3 text-xs ${role === id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {label} <span className="tabular-nums opacity-70">{roleCounts[id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="group" aria-label={tr('Lọc theo trạng thái', 'Filter by status')}>
          {statusOptions.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={status === id}
              onClick={() => setStatus(id)}
              className={`btn !min-h-9 shrink-0 !px-3 text-xs ${status === id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {label} <span className="tabular-nums opacity-70">{statusCounts[id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16 text-[var(--muted)]">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {error && <p className="text-sm text-[var(--danger)]">{errorText(error, tr)}</p>}
      {!isLoading && visible.length === 0 && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-[var(--muted)]">
          <Inbox className="size-6" />
          <p className="text-sm">{tr('Chưa có giao dịch nào trong mục này.', 'No transactions in this tab yet.')}</p>
        </div>
      )}

      <ul className="grid gap-3">
        {visible.map((item) => {
          const ref = item.kind === 'draft' ? item.ref : item.publicId
          const price = item.price
          const title = item.kind === 'draft' ? item.title : (item.title ?? item.terms?.title ?? tr('Giao dịch', 'Transaction'))
          const step = nextStep(item, tr)
          const deadline = deadlineOf(item)
          const remaining = deadline ? deadline.at - now : null
          const overdue = remaining !== null && remaining <= 0
          return (
            <li key={ref}>
              <Link to={`/transactions/${ref}`} className="card block p-4 transition-shadow hover:shadow-lg">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StageChip item={item} />
                      <span className="chip">{item.myRole === 'buyer' ? tr('Bạn là Buyer', 'You are Buyer') : tr('Bạn là Seller', 'You are Seller')}</span>
                    </div>
                    <div className="mt-2 truncate font-semibold">{title}</div>
                    <div className="mono mt-0.5 text-xs text-[var(--subtle)]">{item.kind === 'draft' ? tr('Bản nháp', 'Draft') : item.publicId}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="display text-xl font-bold tabular-nums">{usdcWithCommas(price)}</div>
                      <div className="text-xs text-[var(--subtle)]">USDC</div>
                    </div>
                    <ArrowRight className="size-4 text-[var(--subtle)]" />
                  </div>
                </div>

                {(deadline || step) && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                    {deadline ? (
                      <div className={`flex items-center gap-2 text-xs ${overdue ? 'font-semibold text-[var(--danger)]' : 'text-[var(--ink-2)]'}`}>
                        <Clock className="size-4 shrink-0" />
                        <span>
                          {deadline.label === 'funding' ? tr('Hạn nạp tiền', 'Funding deadline') : tr('Hạn bàn giao', 'Handover deadline')}:{' '}
                          <span className="tabular-nums font-semibold">
                            {overdue ? tr('Đã qua hạn', 'Overdue') : tr(`Còn ${formatDuration(remaining!, lang)}`, `${formatDuration(remaining!, lang)} left`)}
                          </span>{' '}
                          <span className="text-[var(--muted)]">· {formatDateTime(deadline.at, lang)}</span>
                        </span>
                      </div>
                    ) : (
                      <span />
                    )}
                    {step && (
                      <div className={`tx-next ${step.mine ? 'tx-next-mine' : ''}`}>
                        <span className="text-[var(--muted)]">{tr('Bước tiếp theo', 'Next step')}:</span> {step.label}
                        <ArrowRight className="size-3.5 shrink-0" />
                      </div>
                    )}
                  </div>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
