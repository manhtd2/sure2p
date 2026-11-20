import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleHelp, ExternalLink, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { formatDateTime, shortAddress, usdcWithCommas } from '@/lib/format'

interface TrustData {
  network: { chainId: number; usdc: string; explorerBase: string }
  contracts: { escrow: string; registry: string; deployTx: string | null; startBlock: number | null }
  indexer: { cursor: number | null; head: number | null; blocksBehind: number | null; lastError: string | null }
  snapshot: { ok: boolean; blockNumber?: string; blockTimestamp?: number; error?: string; readAt: number }
  reserves: { status: 'covered' | 'shortfall' | 'unknown'; usdcHeld?: string; obligations?: string; surplus?: string; shortfall?: string }
  claims?: { credited: string; claimed: string; pending: string; penaltyPending: string; indexedThroughBlock: number | null }
  escrowCount?: string
  roles?: { owner: string; arbiter: string; appealReviewer: string; penaltyWallet: string; penaltyEqualsOwner: boolean }
  registry?: { deployed: boolean }
}

type Tone = 'ok' | 'warn' | 'unknown'

function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? XCircle : CircleHelp
  const color = tone === 'ok' ? 'text-[var(--success)]' : tone === 'warn' ? 'text-[var(--danger)]' : 'text-[var(--muted)]'
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${color}`}>
      <Icon className="size-4" aria-hidden />
      {children}
    </span>
  )
}

function Row({ title, source, children, status }: { title: string; source: string; children: ReactNode; status: ReactNode }) {
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <th scope="row" className="py-3 pr-3 text-left text-sm font-semibold">{title}</th>
      <td className="py-3 pr-3 text-sm">{children}</td>
      <td className="py-3 pr-3 text-xs text-[var(--muted)]">{source}</td>
      <td className="py-3">{status}</td>
    </tr>
  )
}

export default function Trust() {
  const { lang, tr } = useLang()
  const q = useQuery({ queryKey: ['trust'], queryFn: () => api<TrustData>('/trust'), refetchInterval: 30_000, retry: 1 })
  const d = q.data
  const ex = (path: string) => (d ? `${d.network.explorerBase}${path}` : '#')
  const addr = (a: string) => (
    <a className="mono inline-flex items-center gap-1 underline" href={ex(`/address/${a}`)} target="_blank" rel="noreferrer">
      {shortAddress(a)}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
  const unknownText = tr('Chưa rõ', 'Unknown')
  const readOk = d?.snapshot.ok === true

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Tin cậy', 'Trust')}</h1>
        <p className="mt-2 max-w-3xl text-[var(--ink-2)]">
          {tr(
            'Trang này tách hai thứ: sự thật tài chính máy kiểm chứng được từ chuỗi, và các quyết định tranh chấp do con người đưa ra. Mọi số liệu dưới đây được đọc trực tiếp tại thời điểm bạn mở trang; nếu không đọc được, trang ghi "Chưa rõ" chứ không ghi 0 hay "đủ khả năng chi trả".',
            'This page separates machine-verifiable financial facts from human dispute judgement. Every figure is read live; if it cannot be read, the page says "Unknown", never 0 or "solvent".',
          )}
        </p>
      </header>

      <div className="card p-4 text-sm" role="status">
        {q.isLoading && tr('Đang đọc chuỗi...', 'Reading the chain...')}
        {q.isError && <Status tone="unknown">{tr('Không gọi được máy chủ: toàn bộ số liệu là Chưa rõ.', 'Server unreachable: every figure below is Unknown.')}</Status>}
        {d && readOk && d.snapshot.blockNumber && (
          <span>
            {tr('Ảnh chụp tại khối', 'Snapshot at block')} <span className="mono">{d.snapshot.blockNumber}</span>
            {d.snapshot.blockTimestamp ? ` · ${formatDateTime(d.snapshot.blockTimestamp, lang)}` : ''} · {tr('nguồn: RPC của mạng', 'source: network RPC')}
          </span>
        )}
        {d && !readOk && <Status tone="unknown">{tr('Không đọc được chuỗi lúc này: các số liệu trên chuỗi là Chưa rõ.', 'Chain read failed: onchain figures are Unknown.')}</Status>}
      </div>

      <section className="card overflow-x-auto p-5">
        <h2 className="display text-lg font-bold">{tr('Sự thật tài chính kiểm chứng được', 'Machine-verifiable facts')}</h2>
        <table className="mt-3 w-full min-w-[640px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2 pr-3">{tr('Hạng mục', 'Item')}</th><th className="pb-2 pr-3">{tr('Giá trị', 'Value')}</th>
              <th className="pb-2 pr-3">{tr('Nguồn', 'Source')}</th><th className="pb-2">{tr('Trạng thái', 'Status')}</th>
            </tr>
          </thead>
          <tbody>
            <Row title={tr('Danh tính mạng', 'Network')} source={tr('Cấu hình + tài liệu Arc', 'Config + Arc docs')} status={<Status tone="ok">{tr('Đã cấu hình', 'Configured')}</Status>}>
              {d ? <>Arc Testnet · {tr('mã chuỗi', 'chain id')} {d.network.chainId} · USDC {addr(d.network.usdc)}</> : unknownText}
            </Row>
            <Row title={tr('Hợp đồng ký quỹ', 'Escrow contract')} source={tr('Trên chuỗi', 'Onchain')} status={<Status tone="unknown">{tr('Mã nguồn chưa kiểm chứng trên trình xem chuỗi', 'Source not verified on the explorer')}</Status>}>
              {d ? (
                <>
                  {addr(d.contracts.escrow)}
                  {d.contracts.startBlock ? <> · {tr('khối triển khai', 'deploy block')} <span className="mono">{d.contracts.startBlock}</span></> : null}
                  {d.contracts.deployTx && <> · <a className="underline" href={ex(`/tx/${d.contracts.deployTx}`)} target="_blank" rel="noreferrer">{tr('giao dịch triển khai', 'deploy tx')}</a></>}
                </>
              ) : unknownText}
            </Row>
            <Row title={tr('Sổ đăng ký tài khoản', 'Account registry')} source={tr('Đọc từ chuỗi', 'Read from chain')} status={d?.registry ? <Status tone={d.registry.deployed ? 'ok' : 'warn'}>{d.registry.deployed ? tr('Đã triển khai', 'Deployed') : tr('Chưa triển khai', 'Not deployed')}</Status> : <Status tone="unknown">{unknownText}</Status>}>
              {d ? addr(d.contracts.registry) : unknownText}
            </Row>
            <Row title={tr('Tài sản bảo chứng (USDC hợp đồng đang giữ)', 'Assets held (USDC)')} source={tr('Số dư token tại khối ảnh chụp', 'Token balance at snapshot block')} status={readOk ? <Status tone="ok">{tr('Đã đọc', 'Read')}</Status> : <Status tone="unknown">{unknownText}</Status>}>
              {readOk && d?.reserves.usdcHeld !== undefined ? <span className="mono">{usdcWithCommas(d.reserves.usdcHeld)} USDC</span> : unknownText}
            </Row>
            <Row title={tr('Nghĩa vụ còn nợ', 'Outstanding obligations')} source={tr('Hợp đồng: tiền khóa + khoản chờ nhận chưa rút', 'Contract: locked + unclaimed credits')} status={readOk ? <Status tone="ok">{tr('Đã đọc', 'Read')}</Status> : <Status tone="unknown">{unknownText}</Status>}>
              {readOk && d?.reserves.obligations !== undefined ? <span className="mono">{usdcWithCommas(d.reserves.obligations)} USDC</span> : unknownText}
            </Row>
            <Row
              title={tr('Đối chiếu số dư', 'Reconciliation')}
              source={tr('Cùng một khối', 'Same block')}
              status={
                d?.reserves.status === 'covered' ? <Status tone="ok">{tr('Số dư ≥ nghĩa vụ', 'Balance ≥ obligations')}</Status>
                : d?.reserves.status === 'shortfall' ? <Status tone="warn">{tr('THIẾU: số dư < nghĩa vụ', 'SHORTFALL')}</Status>
                : <Status tone="unknown">{tr('Không kiểm chứng được khả năng chi trả', 'Solvency cannot be verified')}</Status>
              }
            >
              {d?.reserves.status === 'covered' && (
                <>
                  {tr('Phần dư', 'Surplus')}: <span className="mono">{usdcWithCommas(d.reserves.surplus)} USDC</span>
                  {d.escrowCount === '0' && <> · {tr('Chưa có giao dịch nào trên hợp đồng này, nên cả hai số đều bằng 0.', 'No escrow exists on this contract yet, so both figures are 0.')}</>}
                </>
              )}
              {d?.reserves.status === 'shortfall' && <span className="mono">{usdcWithCommas(d.reserves.shortfall)} USDC</span>}
              {d?.reserves.status !== 'covered' && d?.reserves.status !== 'shortfall' && unknownText}
            </Row>
            <Row title={tr('Tổng chờ nhận', 'Pending claims')} source={tr('Bộ quét sự kiện', 'Indexer events')} status={d?.claims ? <Status tone="ok">{tr('Đã quét', 'Indexed')}</Status> : <Status tone="unknown">{unknownText}</Status>}>
              {d?.claims ? (
                <>
                  <span className="mono">{usdcWithCommas(d.claims.pending)} USDC</span>
                  {' '}({tr('trong đó ví phạt', 'of which penalty wallet')} <span className="mono">{usdcWithCommas(d.claims.penaltyPending)}</span>)
                  {d.claims.indexedThroughBlock !== null && <> · {tr('quét tới khối', 'indexed to block')} <span className="mono">{d.claims.indexedThroughBlock}</span></>}
                </>
              ) : unknownText}
            </Row>
            <Row title={tr('Kiểm soát quản trị', 'Admin controls')} source={tr('Hàm đọc công khai của hợp đồng', 'Public contract getters')} status={<Status tone="unknown">{tr('Nhiều chữ ký: chưa cấu hình (D05)', 'Multisig: not configured (D05)')}</Status>}>
              {d?.roles ? (
                <ul className="space-y-0.5">
                  <li>owner: {addr(d.roles.owner)}</li>
                  <li>{tr('người phán quyết', 'arbiter')}: {addr(d.roles.arbiter)}</li>
                  <li>{tr('người xem xét kháng nghị', 'appeal reviewer')}: {addr(d.roles.appealReviewer)}</li>
                </ul>
              ) : unknownText}
            </Row>
            <Row title={tr('Ví nhận tiền phạt', 'Penalty wallet')} source={tr('Cố định trong hợp đồng', 'Fixed in the contract')} status={d?.roles?.penaltyEqualsOwner ? <Status tone="warn">{tr('Trùng ví owner (ngoại lệ có chủ đích)', 'Same as owner (deliberate exception)')}</Status> : d?.roles ? <Status tone="ok">{tr('Tách khỏi owner', 'Separate from owner')}</Status> : <Status tone="unknown">{unknownText}</Status>}>
              {d?.roles ? addr(d.roles.penaltyWallet) : unknownText}
            </Row>
            <Row title={tr('Minh bạch tranh chấp', 'Dispute transparency')} source={tr('Chính sách đã công bố', 'Published policy')} status={<Status tone="unknown">{tr('Chưa có dữ liệu trực tiếp', 'No live data yet')}</Status>}>
              <Link to="/dispute-policy" className="underline">{tr('Quy trình và cửa sổ kháng nghị 72 giờ', 'Process and 72-hour appeal window')}</Link>
            </Row>
            <Row title={tr('Sức khỏe phụ thuộc', 'Dependency health')} source={tr('Đầu dò thật', 'Live probes')} status={<Status tone="unknown">{tr('Xem trang Trạng thái', 'See Status')}</Status>}>
              <Link to="/status" className="underline">/status</Link>
            </Row>
            <Row title={tr('Kiểm toán và rà soát bảo mật', 'Audit and security review')} source={tr('Liên kết độc lập', 'Independent link')} status={<Status tone="warn">{tr('Chưa được kiểm toán bên thứ ba', 'No third-party audit')}</Status>}>
              {tr(
                'Hợp đồng đã có rà soát nội bộ và 335 ca kiểm thử (đơn vị, mờ, bất biến). Đây không phải kiểm toán độc lập.',
                'The contract has an internal review and 335 tests (unit, fuzz, invariant). This is not an independent audit.',
              )}
            </Row>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--muted)]">
          {tr('Tiền đang giữ khác tiền chờ nhận. Nghĩa vụ = tiền khóa + khoản đã ghi có nhưng chưa rút. Không cộng trùng số dư USDC dạng gốc và dạng token.', 'Held funds differ from pending claims. Obligations = locked funds + credited but unclaimed. Native and token USDC are never double counted.')}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="display text-lg font-bold">{tr('Phán đoán của con người', 'Human judgement')}</h2>
          <p className="mt-2 text-sm text-[var(--ink-2)]">
            {tr(
              'Tranh chấp được xử bởi người thật, từng vụ một, trong giới hạn cứng của hợp đồng, kèm một vòng kháng nghị do người khác xem xét. Có một xung đột lợi ích tiềm ẩn: tiền phạt về ví phạt do dự án kiểm soát, và hiện ví owner trùng ví phạt. Các kiểm soát giảm rủi ro: người xem xét kháng nghị độc lập, lý do phán quyết lưu không sửa được, và chủ hợp đồng không chạm được vào tiền.',
              'Disputes are decided by people, case by case, inside hard contract limits, with one appeal reviewed by someone else. There is a potential conflict of interest: penalties go to a wallet the project controls, and the owner currently equals the penalty wallet. Mitigations: independent appeal reviewer, immutable ruling records, and an owner who cannot touch funds.',
            )}
          </p>
        </div>
        <div className="card p-5">
          <h2 className="display text-lg font-bold">{tr('Tự kiểm chứng trong 5 bước', 'Verify it yourself in 5 steps')}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--ink-2)]">
            <li>{tr('Sao chép địa chỉ hợp đồng ở bảng trên.', 'Copy the contract address above.')}</li>
            <li>{tr('Mở trình xem chuỗi và dán địa chỉ.', 'Open the explorer and paste it.')}</li>
            <li>{tr('Kiểm tra mã chuỗi và các hàm đọc về vai trò.', 'Check the chain id and the role getters.')}</li>
            <li>{tr('Đọc số dư USDC và totalOutstanding ở cùng một khối.', 'Read the USDC balance and totalOutstanding at one block.')}</li>
            <li>{tr('Đối chiếu biên lai giao dịch với ứng dụng.', 'Match transaction receipts to the app.')}</li>
          </ol>
          <Link to="/docs/trust/verify-escrow" className="mt-2 inline-block text-sm font-semibold underline">{tr('Hướng dẫn chi tiết', 'Detailed guide')}</Link>
        </div>
      </section>
    </div>
  )
}
