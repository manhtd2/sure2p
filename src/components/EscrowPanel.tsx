import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID } from '@/lib/contracts'
import { shortAddress, usdcWithCommas } from '@/lib/format'
import type { EscrowView, HistoryEvent } from '@/lib/types'
import { CHAIN_STATE, useEscrowChain } from '@/hooks/useEscrowChain'
import { AttachmentList } from './AttachmentList'
import { ClaimPanel } from './ClaimPanel'
import { EscrowActions } from './EscrowActions'
import { HistoryList } from './HistoryList'
import { Loader } from './Loader'
import { EvidencePanel } from './EvidencePanel'
import { DeliveryProofPanel } from './DeliveryProofPanel'
import { ProgressTimeline } from './ProgressTimeline'
import { RulingPanel } from './RulingPanel'
import { SettlementPanel } from './SettlementPanel'
import { StageLabel } from './StageChip'

export function EscrowPanel({ publicId }: { publicId: string }) {
  const { tr } = useLang()
  const qc = useQueryClient()
  const { address, chainId } = useAccount()

  const view = useQuery({
    queryKey: ['escrow', publicId],
    queryFn: () => api<EscrowView>(`/transactions/${publicId}`),
    refetchInterval: 5000,
  })
  const history = useQuery({
    queryKey: ['escrow-history', publicId],
    queryFn: () => api<{ events: HistoryEvent[] }>(`/transactions/${publicId}/history`),
    refetchInterval: 6000,
  })
  const chain = useEscrowChain(view.data?.onChainId)

  if (view.error) return <p className="card p-6 text-sm text-[var(--danger)]">{errorText(view.error, tr)}</p>
  if (!view.data || chain.isLoading) return <Loader />
  const v = view.data
  const c = chain.data
  if (!c) return <p className="card p-6 text-sm text-[var(--danger)]">{tr('Không đọc được trạng thái trên chuỗi. Hãy thử lại.', 'Could not read the onchain state. Please retry.')}</p>

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['escrow', publicId] })
    void qc.invalidateQueries({ queryKey: ['escrow-history', publicId] })
    void qc.invalidateQueries({ queryKey: ['transactions'] })
    void chain.refetch()
  }

  const state = Number(c.state)
  const wallet = address
  const walletOk = wallet && wallet.toLowerCase() === (v.myRole === 'buyer' ? v.buyerWallet : v.sellerWallet).toLowerCase()
  const price = BigInt(v.price)
  const events = history.data?.events ?? []
  const stage =
    state === CHAIN_STATE.Funding ? 'funding'
    : state === CHAIN_STATE.Active ? 'active'
    : state === CHAIN_STATE.Overdue ? 'overdue'
    : state === CHAIN_STATE.Disputed ? 'disputed'
    : state === CHAIN_STATE.PreliminaryRuling ? 'preliminary_ruling'
    : state === CHAIN_STATE.Appealed ? 'appealed'
    : state === CHAIN_STATE.ExpiredUnfunded ? 'expired_unfunded'
    : v.stage === 'settled' ? 'settled' : v.stage === 'ruled' ? 'ruled' : 'completed'
  const locked = state === CHAIN_STATE.Overdue || state === CHAIN_STATE.Disputed
  const underRuling = state === CHAIN_STATE.PreliminaryRuling || state === CHAIN_STATE.Appealed
  const settleable = state === CHAIN_STATE.Active || locked || underRuling
  const caseOpen = locked || underRuling
  const terminal = state === CHAIN_STATE.Finalized || state === CHAIN_STATE.ExpiredUnfunded

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StageLabel stage={stage} />
          <span className="chip">{v.myRole === 'buyer' ? tr('Bạn là Buyer', 'You are Buyer') : tr('Bạn là Seller', 'You are Seller')}</span>
          <span className="chip mono">{v.publicId}</span>
        </div>
        <h1 className="display text-3xl font-bold">{v.terms?.title ?? tr('Giao dịch', 'Transaction')}</h1>
      </div>

      {!walletOk && (
        <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]" role="alert">
          {tr(`Hãy kết nối ví ${shortAddress(v.myRole === 'buyer' ? v.buyerWallet : v.sellerWallet)} để thao tác.`, `Connect wallet ${shortAddress(v.myRole === 'buyer' ? v.buyerWallet : v.sellerWallet)} to act.`)}
        </p>
      )}
      {chainId !== undefined && chainId !== CHAIN_ID && (
        <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]" role="alert">{tr('Ví đang ở sai mạng. Thao tác sẽ tự chuyển sang Arc Testnet.', 'Your wallet is on the wrong network. Actions will switch you to Arc Testnet.')}</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          {c.activatedAt > 0n && (state === CHAIN_STATE.Active || locked) && (
            <ProgressTimeline priceUnits={price} activatedAt={Number(c.activatedAt)} handoverDeadline={Number(c.handoverDeadline)} locked={locked} lockedLabel={state === CHAIN_STATE.Disputed ? tr('Tranh chấp', 'Disputed') : tr('Quá hạn', 'Overdue')} />
          )}
          {walletOk && wallet && !terminal && <EscrowActions view={v} chain={c} wallet={wallet} onChanged={refresh} />}
          {walletOk && (caseOpen || (terminal && v.ruling)) && <RulingPanel view={v} state={state} onChanged={refresh} />}
          {walletOk && settleable && <SettlementPanel view={v} onChanged={refresh} />}
          {walletOk && c.sellerHandoverDeclared && (state === CHAIN_STATE.Active || caseOpen || terminal) && (
            <DeliveryProofPanel
              publicId={v.publicId}
              viewer={v.myRole}
              canUpload={v.myRole === 'seller' && (state === CHAIN_STATE.Active || caseOpen)}
              hideWhenEmpty={terminal}
            />
          )}
          {walletOk && (caseOpen || (terminal && v.ruling)) && (
            <EvidencePanel publicId={v.publicId} onChainId={v.onChainId} canUpload={caseOpen} canAnchor={caseOpen} />
          )}
          {walletOk && wallet && terminal && <ClaimPanel view={v} wallet={wallet} events={events} onChanged={refresh} />}
          <section className="card space-y-3 p-5">
            <h2 className="display text-lg font-semibold">{tr('Lịch sử trên chuỗi', 'Onchain history')}</h2>
            <HistoryList events={events} />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card space-y-3 p-5">
            <div className="label">{tr('Số tiền (đọc từ chuỗi)', 'Amounts (read from chain)')}</div>
            <dl className="space-y-2 text-sm">
              <Row label={tr('Giá hàng hóa', 'Goods price')} value={`${usdcWithCommas(c.price)} USDC`} note={c.buyerFunded ? tr('đã khóa', 'locked') : tr('chưa khóa', 'not locked yet')} />
              <Row label={tr('Cọc Buyer', 'Buyer deposit')} value={`${usdcWithCommas(c.buyerDeposit)} USDC`} note={c.buyerFunded ? tr('đã nạp', 'funded') : tr('chưa nạp', 'not funded')} />
              <Row label={tr('Cọc Seller', 'Seller deposit')} value={`${usdcWithCommas(c.sellerDeposit)} USDC`} note={c.sellerFunded ? tr('đã nạp', 'funded') : tr('chưa nạp', 'not funded')} />
            </dl>
            {state === CHAIN_STATE.Active && <p className="rounded-xl bg-[var(--surface-muted)] p-3 text-xs text-[var(--muted)]">{tr('100% giá đã ký quỹ. Có thể rút trước khi xác nhận: 0 USDC.', '100% of the price is escrowed. Withdrawable before confirmation: 0 USDC.')}</p>}
          </section>
          <section className="card space-y-2 p-5 text-xs text-[var(--muted)]">
            <div className="label">{tr('Bên tham gia và ví nhận cố định', 'Parties and fixed payout wallets')}</div>
            <div>Buyer <span className="mono break-all">{v.buyerWallet}</span></div>
            <div>Seller <span className="mono break-all">{v.sellerWallet}</span></div>
            <div className="pt-2"><span className="label !mb-0.5">Agreement hash</span><span className="mono break-all">{v.agreementHash}</span></div>
            <a className="inline-flex items-center gap-1 pt-1 text-[var(--accent-hover)] underline" href={buildTxExplorerUrl(CHAIN_ID, v.creationTx)} target="_blank" rel="noopener noreferrer">
              {tr('Giao dịch tạo escrow', 'Escrow creation transaction')} <ExternalLink className="size-3" />
            </a>
          </section>
          {v.terms && (
            <section className="card space-y-2 p-5 text-sm">
              <div className="label">{tr('Điều khoản đã ký', 'Signed terms')}</div>
              <p className="whitespace-pre-wrap break-words text-[var(--ink-2)]">{v.terms.description}</p>
              <p className="text-xs text-[var(--muted)]">{tr('Tiêu chí nghiệm thu', 'Acceptance criteria')}: {v.terms.acceptanceCriteria}</p>
              {(v.terms.attachments?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="label">{tr('Tài liệu mô tả hàng của Buyer', "Buyer's description files")}</div>
                  <AttachmentList
                    files={v.terms.attachments!}
                    href={(sha) => `/api/transactions/${v.publicId}/evidence?attachment=${sha}`}
                    lock={state === CHAIN_STATE.Funding ? 'signed' : 'evidence'}
                  />
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--muted)]">{label} <span className="text-xs text-[var(--subtle)]">({note})</span></dt>
      <dd className="tabular-nums font-semibold">{value}</dd>
    </div>
  )
}
