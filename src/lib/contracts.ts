import { getAddress } from 'viem'
import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'
import { escrowAbi } from '@/shared/escrowAbi'

function envAddress(value: string | undefined, name: string): `0x${string}` {
  if (!value) throw new Error(`${name} is not set in .env`)
  return getAddress(value)
}

export const CHAIN_ID = arcTestnet.id
export const ESCROW_ADDRESS = envAddress(import.meta.env.VITE_SURE2P_ESCROW_ADDRESS as string | undefined, 'VITE_SURE2P_ESCROW_ADDRESS')
export const REGISTRY_ADDRESS = envAddress(import.meta.env.VITE_ACCOUNT_REGISTRY_ADDRESS as string | undefined, 'VITE_ACCOUNT_REGISTRY_ADDRESS')

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('USDC is not registered for Arc Testnet')
export const USDC_ADDRESS = getAddress(usdcFact.address)

export { escrowAbi }
