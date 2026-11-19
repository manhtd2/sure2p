import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount, useWriteContract } from 'wagmi'
import { Coins } from 'lucide-react'
import { useLang } from '@/i18n'
import { api, errorText } from '@/lib/api'
import { CHAIN_ID, ESCROW_ADDRESS, escrowAbi } from '@/lib/contracts'
import { usdcWithCommas } from '@/lib/format'
import { useClaimable } from '@/hooks/useEscrowChain'
import { ChainAction } from './ChainAction'
import { Loader } from './Loader'

interface PenaltyItem {
  onChainId: string
  publicId: string | null
  title: string | null
  credited: string
  claimed: string
}

/** Penalties from rulings, credited to the contract's penalty wallet. Each escrow is claimed separately. */
export function PenaltyPanel() {
  const { tr } = useLang()
  const { address } = useAccount()
  const q = useQuery({
    queryKey: ['admin-penalty'],
    queryFn: () => api<{ wallet: string; items: PenaltyItem[] }>('/admin/penalty'),
    refetchInterval: 10_000,
  })
  if (q.isLoading) return <Loader />
  if (q.error) return <p className="card p-6 text-sm text-[var(--danger)]">{errorText(q.error, tr)}</p>
  const items = q.data?.items ?? []
  const wrongWallet = Boolean(address) && address!.toLowerCase() !== q.data?.wallet.toLowerCase()
  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="display flex items-center gap-2 text-lg font-semibold"><Coins className="size-4" /> {tr('Tiền phạt của ví penalty', 'Penalty wallet payouts')}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {tr('Mỗi giao dịch có phạt được ghi có riêng và phải claim riêng. Tiền chỉ về đúng ví penalty cố định trong hợp đồng.', 'Each ruling with a penalty is credited and claimed per deal. Funds go only to the penalty wallet fixed in the contract.')}
        </p>
      </div>
      {wrongWallet && <p className="rounded-xl bg-[#fff4d6] p-3 text-sm text-[var(--warn)]" role="alert">{tr('Hãy kết nối đúng ví penalty để claim.', 'Connect the penalty wallet to claim.')}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{tr('Chưa có khoản phạt nào được ghi có.', 'No penalty has been credited yet.')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <PenaltyRow key={i.onChainId} item={i} wallet={q.data!.wallet as `0x${string}`} disabled={wrongWallet} />
          ))}
        </ul>
      )}
    </section>
  )
}

function PenaltyRow({ item, wallet, disabled }: { item: PenaltyItem; wallet: `0x${string}`; disabled: boolean }) {
  const { tr } = useLang()
  const qc = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const claimable = useClaimable(item.onChainId, wallet)
  const open = claimable.data ?? 0n
  return (
    <li className="inner space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{item.title ?? tr('Giao dịch', 'Transaction')}</span>
        {item.publicId && <span className="chip mono">{item.publicId}</span>}
      </div>
      <div className="text-xs text-[var(--muted)]">
        {tr('Được ghi có', 'Credited')}: <span className="tabular-nums">{usdcWithCommas(item.credited)} USDC</span> · {tr('Đã nhận vào ví', 'Received in wallet')}: <span className="tabular-nums">{usdcWithCommas(item.claimed)} USDC</span>
      </div>
      {open > 0n ? (
        <ChainAction
          label={`Claim ${usdcWithCommas(open)} USDC`}
          disabled={disabled}
          send={() => writeContractAsync({ address: ESCROW_ADDRESS, abi: escrowAbi, functionName: 'claim', args: [BigInt(item.onChainId)], chainId: CHAIN_ID })}
          onDone={async () => {
            await claimable.refetch()
            await qc.invalidateQueries({ queryKey: ['admin-penalty'] })
          }}
        />
      ) : (
        <p className="text-xs text-[var(--success)]">{tr('Đã claim hết khoản này.', 'This payout is fully claimed.')}</p>
      )}
    </li>
  )
}
