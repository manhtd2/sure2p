import { useCallback, useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi'
import type { Hex } from 'viem'
import { CHAIN_ID } from '@/lib/contracts'

export type TxPhase = 'idle' | 'awaiting_signature' | 'pending' | 'confirmed' | 'failed' | 'rejected'

export interface TxState {
  phase: TxPhase
  hash?: Hex
  error?: string
}

/** Maps wallet and RPC errors to short, user-facing reasons. User rejection is not an error. */
export function parseTxError(err: unknown, tr: (vi: string, en: string) => string): { rejected: boolean; message: string } {
  const e = err as { code?: number; message?: string; shortMessage?: string; cause?: { code?: number } }
  const msg = `${e?.shortMessage ?? ''} ${e?.message ?? ''}`.toLowerCase()
  if (e?.code === 4001 || e?.cause?.code === 4001 || msg.includes('user rejected') || msg.includes('user denied')) {
    return { rejected: true, message: tr('Bạn đã hủy yêu cầu trong ví.', 'You cancelled the request in your wallet.') }
  }
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
    return { rejected: false, message: tr('Số dư không đủ để thanh toán phí gas hoặc số tiền.', 'Not enough balance for gas or the amount.') }
  }
  if (msg.includes('reverted') || msg.includes('revert')) {
    const reason = /reason: ([^\n]+)|custom error ([^\n]+)|error: ([A-Za-z0-9_]+)\(/i.exec(e?.shortMessage ?? e?.message ?? '')
    const tail = reason ? ` (${(reason[1] ?? reason[2] ?? reason[3]).slice(0, 80)})` : ''
    return { rejected: false, message: tr(`Giao dịch bị hợp đồng từ chối${tail}.`, `The contract rejected the transaction${tail}.`) }
  }
  if (msg.includes('network') || msg.includes('timeout') || msg.includes('fetch')) {
    return { rejected: false, message: tr('Lỗi mạng. Hãy kiểm tra kết nối và thử lại.', 'Network issue. Check your connection and retry.') }
  }
  return { rejected: false, message: tr('Giao dịch không thành công. Hãy thử lại.', 'The transaction did not go through. Please try again.') }
}

/**
 * Runs one wallet transaction through its real states:
 * awaiting signature -> pending (broadcast) -> confirmed only after receipt.status is success.
 */
export function useTx(tr: (vi: string, en: string) => string) {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const [state, setState] = useState<TxState>({ phase: 'idle' })

  const run = useCallback(
    async (send: () => Promise<Hex>, onConfirmed?: (hash: Hex) => unknown, onSubmitted?: (hash: Hex) => unknown) => {
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        setState({ phase: 'awaiting_signature' })
        const hash = await send()
        setState({ phase: 'pending', hash })
        await onSubmitted?.(hash)
        if (!publicClient) throw new Error('network')
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') {
          setState({ phase: 'failed', hash, error: tr('Giao dịch đã bị revert trên chuỗi.', 'The transaction reverted onchain.') })
          return false
        }
        setState({ phase: 'confirmed', hash })
        await onConfirmed?.(hash)
        return true
      } catch (err) {
        const parsed = parseTxError(err, tr)
        setState(parsed.rejected ? { phase: 'rejected', error: parsed.message } : { phase: 'failed', error: parsed.message })
        return false
      }
    },
    [chainId, switchChainAsync, publicClient, tr],
  )

  const reset = useCallback(() => setState({ phase: 'idle' }), [])
  return { state, run, reset, busy: state.phase === 'awaiting_signature' || state.phase === 'pending' }
}
