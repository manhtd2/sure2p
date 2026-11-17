import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useSignTypedData, useWriteContract } from 'wagmi'
import { CheckCircle2, CircleDashed, Loader2, PenLine, RefreshCw } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { formatDateTime, shortAddress } from '@/lib/format'
import type { DraftView } from '@/lib/types'
import { agreementFromJson, agreementTypes, eip712Domain } from '@/shared/protocol'
import { handoverDeadlineError } from '@/shared/validation'
import { useTx, parseTxError } from '@/hooks/useTx'
import { useNow } from '@/hooks/useNow'
import { AmountBreakdown } from './AmountBreakdown'
import { InvitePanel } from './InvitePanel'
import { RiskDisclosure } from './RiskDisclosure'
import { AgreementDiff, TermsSummary } from './TermsSummary'
import { TermsForm } from './TermsForm'
import { TxButton } from './TxButton'
import { Loader } from './Loader'
import type { DealTerms } from '@/shared/protocol'

export function DraftPanel({ draftId }: { draftId: string }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { address } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync } = useWriteContract()
  const tx = useTx(tr)
  const now = useNow(30_000)

  const { data: draft, error } = useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => api<DraftView>(`/drafts/${draftId}`),
    refetchInterval: 4000,
  })
  const [ack, setAck] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (error) return <p className="card p-6 text-sm text-[var(--danger)]">{errorText(error, tr)}</p>
  if (!draft) return <Loader />
  if (draft.publicId) return <Navigate to={`/transactions/${draft.publicId}`} replace />

  const versions = draft.versions
  const latest = versions[versions.length - 1]
  const previous = versions.length > 1 ? versions[versions.length - 2] : null
  const terms = latest.terms
  const priceUnits = BigInt(terms.priceUnits)
  const mine = draft.myRole
  const iSigned = mine === 'buyer' ? latest.buyerSigned : latest.sellerSigned
  const bothSigned = latest.buyerSigned && latest.sellerSigned
  const walletMismatch = Boolean(address) && address!.toLowerCase() !== (mine === 'buyer' ? draft.buyerWallet : draft.sellerWallet)?.toLowerCase()
  const nowSec = now
  const expired = latest.signDeadline < nowSec + 3600
  const deadlineTooClose = Boolean(handoverDeadlineError(terms.handoverDeadline, nowSec))
  const submitted = draft.status === 'submitted' && Boolean(draft.createTxHash)

  async function counter(next: DealTerms) {
    setBusy(true)
    setActionError(null)
    try {
      await api(`/drafts/${draftId}?action=counteroffer`, { body: { terms: next } })
      setEditing(false)
      setAck(false)
      await qc.invalidateQueries({ queryKey: ['draft', draftId] })
    } catch (e) {
      setActionError(errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  async function sign() {
    if (!latest.agreement) return
    setBusy(true)
    setActionError(null)
    try {
      const signature = await signTypedDataAsync({
        domain: eip712Domain(CHAIN_ID, ESCROW_ADDRESS),
        types: agreementTypes,
        primaryType: 'Agreement',
        message: agreementFromJson(latest.agreement),
      })
      await api(`/drafts/${draftId}?action=sign`, { body: { versionId: latest.id, signature, acknowledgedDisclosure: true } })
      await qc.invalidateQueries({ queryKey: ['draft', draftId] })
    } catch (e) {
      const parsed = parseTxError(e, tr)
      setActionError(parsed.rejected ? parsed.message : errorText(e, tr))
    } finally {
      setBusy(false)
    }
  }

  function createEscrow() {
    if (!latest.agreement || !latest.buyerSig || !latest.sellerSig) return
    const agreement = agreementFromJson(latest.agreement)
    const buyerSig = latest.buyerSig as `0x${string}`
    const sellerSig = latest.sellerSig as `0x${string}`
    void tx.run(
      () => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'createEscrow', args: [agreement, buyerSig, sellerSig], chainId: CHAIN_ID }),
      async () => {
        await qc.invalidateQueries({ queryKey: ['draft', draftId] })
      },
      async (hash) => {
        await api(`/drafts/${draftId}?action=submitted`, { body: { txHash: hash } })
      },
    )
  }

  const step = !draft.claimed ? 1 : !bothSigned ? 2 : 3
  const stepLabels = [tr('Mời', 'Invite'), tr('Đàm phán và ký', 'Negotiate and sign'), tr('Tạo escrow', 'Create escrow')]

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap gap-2">
          <span className="chip">{tr('Bản nháp ngoài chuỗi', 'Offchain draft')}</span>
          <span className="chip">{mine === 'buyer' ? tr('Bạn là Buyer', 'You are Buyer') : tr('Bạn là Seller', 'You are Seller')}</span>
          <span className="chip">v{latest.version}</span>
        </div>
        <h1 className="display text-3xl font-bold">{terms.title}</h1>
        <p className="mono mt-1 text-xs text-[var(--subtle)]">{draft.id}</p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs font-semibold">
        {stepLabels.map((label, i) => (
          <li key={label} className={`chip ${step === i + 1 ? '!bg-[var(--accent)] !text-white' : step > i + 1 ? '!bg-[#e3f4ea] !text-[var(--success)]' : ''}`}>
            {step > i + 1 ? <CheckCircle2 className="size-3.5" /> : <span>{i + 1}</span>} {label}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <section className="card space-y-4 p-5">
            <h2 className="display text-lg font-semibold">{tr('Điều khoản hiện tại', 'Current terms')}</h2>
            <TermsSummary terms={terms} />
            {previous && (
              <details className="inner p-3">
                <summary className="cursor-pointer text-sm font-semibold">{tr(`So sánh với v${previous.version}`, `Compare with v${previous.version}`)}</summary>
                <div className="mt-3"><AgreementDiff previous={previous.terms} current={terms} /></div>
                <p className="mt-2 text-xs text-[var(--muted)]">{tr('Mọi thay đổi vô hiệu hóa chữ ký trước đó. Hai bên phải ký lại phiên bản mới.', 'Any change invalidates earlier signatures. Both parties must sign the new version.')}</p>
              </details>
            )}
          </section>

          {draft.isCreator && !draft.claimed && <InvitePanel draft={draft} />}

          {draft.claimed && (
            <section className="card space-y-4 p-5">
              <h2 className="display text-lg font-semibold">{tr('Ký thỏa thuận', 'Sign the agreement')}</h2>
              <ul className="space-y-2 text-sm">
                {([['buyer', latest.buyerSigned, draft.buyerWallet], ['seller', latest.sellerSigned, draft.sellerWallet]] as const).map(([role, signed, wallet]) => (
                  <li key={role} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      {signed ? <CheckCircle2 className="size-4 text-[var(--success)]" /> : <CircleDashed className="size-4 text-[var(--subtle)]" />}
                      {role === 'buyer' ? 'Buyer' : 'Seller'} <span className="mono text-xs text-[var(--subtle)]">{shortAddress(wallet)}</span>
                    </span>
                    <span className="text-xs text-[var(--muted)]">{signed ? tr('Đã ký', 'Signed') : tr('Chưa ký', 'Not signed')}</span>
                  </li>
                ))}
              </ul>

              {!iSigned && !expired && !deadlineTooClose && (
                <>
                  <RiskDisclosure priceUnits={priceUnits} buyerWallet={draft.buyerWallet} sellerWallet={draft.sellerWallet} onAcknowledge={setAck} />
                  {walletMismatch && (
                    <p className="text-sm text-[var(--danger)]">{tr(`Hãy kết nối ví ${shortAddress(mine === 'buyer' ? draft.buyerWallet : draft.sellerWallet)} đã gắn với giao dịch này.`, `Connect the wallet ${shortAddress(mine === 'buyer' ? draft.buyerWallet : draft.sellerWallet)} bound to this deal.`)}</p>
                  )}
                  <button type="button" className="btn btn-primary w-full" disabled={!ack || busy || walletMismatch} onClick={() => void sign()}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />} {tr('Ký phiên bản này', 'Sign this version')}
                  </button>
                </>
              )}
              {iSigned && !bothSigned && (
                <p className="text-sm text-[var(--muted)]">{tr('Bạn đã ký. Đang chờ đối tác ký cùng phiên bản này.', 'You signed. Waiting for your counterparty to sign this same version.')}</p>
              )}
              {(expired || deadlineTooClose) && !bothSigned && (
                <div className="space-y-2">
                  <p className="text-sm text-[var(--warn)]">
                    {deadlineTooClose
                      ? tr('Hạn bàn giao đã quá gần để còn đủ 24 giờ nạp tiền. Hãy đề xuất hạn mới.', 'The handover deadline is too close to leave the 24-hour funding window. Propose a new deadline.')
                      : tr('Phiên bản này sắp hết hạn chữ ký. Hãy làm mới thỏa thuận.', 'This version is about to expire for signing. Renew the agreement.')}
                  </p>
                  {!deadlineTooClose && (
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void counter(terms)}>
                      <RefreshCw className="size-4" /> {tr('Làm mới thỏa thuận (cùng nội dung)', 'Renew agreement (same terms)')}
                    </button>
                  )}
                </div>
              )}

              {bothSigned && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-[#e3f4ea] p-3 text-sm text-[var(--success)]">
                    {tr('Cả hai đã ký. Bất kỳ bên nào cũng có thể tạo escrow trên chuỗi; chưa có khoản tiền nào bị khóa cho đến khi nạp.', 'Both signed. Either party can create the escrow onchain; nothing is locked until funding.')}
                  </div>
                  {submitted && tx.state.phase === 'idle' ? (
                    <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> {tr('Đã gửi giao dịch tạo escrow, đang chờ lập chỉ mục (Awaiting indexing)...', 'Escrow creation submitted. Awaiting indexing...')}</p>
                  ) : (
                    <TxButton label={tr('Tạo escrow trên Arc Testnet', 'Create escrow on Arc Testnet')} state={tx.state} onClick={createEscrow} disabled={expired || deadlineTooClose} hint={tr('Bạn trả gas bằng USDC. Hạn nạp tiền 24 giờ bắt đầu khi giao dịch này được xác nhận.', 'You pay gas in USDC. The 24-hour funding window starts when this transaction confirms.')} />
                  )}
                  {tx.state.phase === 'confirmed' && (
                    <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="size-4 animate-spin" /> {tr('Đã xác nhận. Đang chờ lập chỉ mục để cấp mã giao dịch (Awaiting indexing)...', 'Confirmed. Awaiting indexing to assign the public ID...')}</p>
                  )}
                </div>
              )}
            </section>
          )}

          {draft.claimed && !bothSigned && (
            <section className="card space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-lg font-semibold">{tr('Đề xuất lại (counteroffer)', 'Counteroffer')}</h2>
                <button type="button" className="btn btn-ghost !min-h-9 text-xs" onClick={() => setEditing((v) => !v)}>
                  {editing ? tr('Đóng', 'Close') : tr('Chỉnh điều khoản', 'Edit terms')}
                </button>
              </div>
              {editing ? (
                <TermsForm initial={terms} submitLabel={tr('Gửi phiên bản mới', 'Send new version')} busy={busy} onSubmit={(t) => void counter(t)} />
              ) : (
                <p className="text-sm text-[var(--muted)]">{tr('Đề xuất lại tạo một phiên bản bất biến mới; chữ ký trước đó không còn hiệu lực.', 'A counteroffer creates a new immutable version; earlier signatures stop applying.')}</p>
              )}
            </section>
          )}
          {!draft.claimed && draft.isCreator && (
            <section className="card space-y-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="display text-lg font-semibold">{tr('Chỉnh bản nháp', 'Edit draft')}</h2>
                <button type="button" className="btn btn-ghost !min-h-9 text-xs" onClick={() => setEditing((v) => !v)}>
                  {editing ? tr('Đóng', 'Close') : tr('Chỉnh', 'Edit')}
                </button>
              </div>
              {editing && <TermsForm initial={terms} submitLabel={tr('Lưu phiên bản mới', 'Save new version')} busy={busy} onSubmit={(t) => void counter(t)} />}
            </section>
          )}
          {actionError && <p className="text-sm text-[var(--danger)]" role="alert">{actionError}</p>}
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <div className="label">{tr('Số tiền ký quỹ', 'Escrow amounts')}</div>
            <AmountBreakdown priceUnits={priceUnits} />
            <p className="mt-3 text-xs text-[var(--muted)]">
              {tr('Mỗi bên cần đủ số dư USDC (cộng một ít gas) để nạp sau khi escrow được tạo.', 'Each side needs enough USDC (plus a little for gas) to fund once the escrow is created.')}
            </p>
          </div>
          <div className="card space-y-2 p-5 text-xs text-[var(--muted)]">
            <div><span className="label !mb-0.5">Agreement hash</span><span className="mono break-all">{latest.agreementHash ?? tr('Sẽ có sau khi đối tác tham gia', 'Available once the counterparty joins')}</span></div>
            <div><span className="label !mb-0.5">{tr('Chữ ký có hiệu lực đến', 'Signatures valid until')}</span>{formatDateTime(latest.signDeadline, lang)}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
