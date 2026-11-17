import { useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { CHAIN_ID, ESCROW_ADDRESS, USDC_ADDRESS, escrowAbi } from '@/lib/contracts'

/** Contract enum order (Sure2PEscrowV2). */
export const CHAIN_STATE = {
  None: 0,
  Funding: 1,
  Active: 2,
  Overdue: 3,
  Disputed: 4,
  PreliminaryRuling: 5,
  Appealed: 6,
  Finalized: 7,
  ExpiredUnfunded: 8,
} as const

export type ChainEscrow = NonNullable<ReturnType<typeof useEscrowChain>['data']>

/** Live escrow struct straight from the chain: the source of truth for every action gate. */
export function useEscrowChain(onChainId: string | undefined) {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'getEscrow',
    args: onChainId ? [BigInt(onChainId)] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(onChainId), refetchInterval: 4000 },
  })
}

export function useClaimable(onChainId: string | undefined, wallet: `0x${string}` | undefined) {
  return useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: 'claimable',
    args: onChainId && wallet ? [BigInt(onChainId), wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(onChainId && wallet), refetchInterval: 4000 },
  })
}

/** USDC ERC-20 view only: balance and the allowance granted to the escrow. Never summed with native gas. */
export function useUsdcAccount(wallet: `0x${string}` | undefined) {
  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(wallet), refetchInterval: 5000 },
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: wallet ? [wallet, ESCROW_ADDRESS] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(wallet), refetchInterval: 5000 },
  })
  return { balance, allowance }
}
