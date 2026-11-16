import { useWriteContract } from 'wagmi'
import { CheckCircle2, Hourglass } from 'lucide-react'
import { useLang } from '@/i18n'
import { api } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { usdcWithCommas } from '@/lib/format'
import type { EscrowView, HistoryEvent } from '@/lib/types'
import { useClaimable } from '@/hooks/useEscrowChain'
import { ChainAction } from './ChainAction'

interface Props {
  view: EscrowView
  wallet: `0x${string}`
  events: HistoryEvent[]
  onChanged: () => void
}

function sum(events: HistoryEvent[], name: string, wallet: string): bigint {
  return events
    .filter((e) => e.name === name && e.args.account?.toLowerCase() === wallet.toLowerCase())
    .reduce((acc, e) => acc + BigInt(e.args.amount ?? '0'), 0n)
}

/**
 * Separates "funds released and claimable" (credit in the contract) from "received in wallet"
 * (a confirmed Claimed event). Nothing says "paid" before a real receipt.
 */
export function ClaimPanel({ view, wallet, events, onChanged }: Props) {
  const { tr } = useLang()
  const { writeContractAsync } = useWriteContract()
  const claimable = useClaimable(view.onChainId, wallet)
  const assigned = sum(events, 'CreditAssigned', wallet)
  const received = sum(events, 'Claimed', wallet)
  const open = claimable.data ?? 0n

  return (
    <section className="card space-y-4 p-5">
      <h2 className="display text-lg font-semibold">{tr('Nhận tiền về ví', 'Claim to your wallet')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="inner p-4">
          <div className="label flex items-center gap-1"><Hourglass className="size-3" /> {tr('Đã giải phóng, có thể claim', 'Released, claimable')}</div>
          <div className="display text-2xl font-bold tabular-nums">{usdcWithCommas(open)} <span className="text-sm font-medium text-[var(--subtle)]">USDC</span></div>
          <div className="mt-1 text-xs text-[var(--muted)]">{tr('Đang nằm trong hợp đồng, chưa vào ví của bạn.', 'Still inside the contract, not in your wallet yet.')}</div>
        </div>
        <div className="inner p-4">
          <div className="label flex items-center gap-1"><CheckCircle2 className="size-3" /> {tr('Đã nhận vào ví', 'Received in wallet')}</div>
          <div className="display text-2xl font-bold tabular-nums">{usdcWithCommas(received)} <span className="text-sm font-medium text-[var(--subtle)]">USDC</span></div>
          <div className="mt-1 text-xs text-[var(--muted)]">{tr('Chỉ tính sau khi giao dịch claim có receipt thành công.', 'Counted only after the claim transaction has a successful receipt.')}</div>
        </div>
      </div>
      {assigned > 0n && <p className="text-xs text-[var(--muted)]">{tr('Tổng được ghi có cho ví của bạn', 'Total credited to your wallet')}: <span className="tabular-nums">{usdcWithCommas(assigned)} USDC</span></p>}
      {open > 0n && (
        <ChainAction
          label={`Claim ${usdcWithCommas(open)} USDC`}
          hint={tr('Bạn trả gas bằng USDC. Tiền chỉ về đúng ví đã ký trong thỏa thuận.', 'You pay gas in USDC. Funds go only to the wallet fixed in the agreement.')}
          send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'claim', args: [BigInt(view.onChainId)], chainId: CHAIN_ID })}
          onSubmitted={(hash) => api(`/transactions/${view.publicId}/tx`, { body: { txHash: hash, action: 'claim' } }).catch(() => undefined)}
          onDone={async () => {
            await claimable.refetch()
            onChanged()
          }}
        />
      )}
      {open === 0n && received > 0n && <p className="text-sm text-[var(--success)]">{tr('Bạn đã claim hết phần của mình.', 'You have claimed everything owed to you.')}</p>}
      {open === 0n && received === 0n && assigned === 0n && <p className="text-sm text-[var(--muted)]">{tr('Không có khoản nào được ghi có cho ví này.', 'Nothing is credited to this wallet.')}</p>}
    </section>
  )
}
