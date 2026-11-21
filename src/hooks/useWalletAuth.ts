import { useCallback } from 'react'
import { useAccount, useDisconnect } from 'wagmi'

/** Thrown when the wallet no longer exposes the account this page thinks is connected (EIP-1193 code 4100). */
export class WalletAuthError extends Error {
  code = 4100
  constructor() {
    super('The requested account has not been authorized by the user')
    this.name = 'WalletAuthError'
  }
}

interface Eip1193 {
  request?: (args: { method: string }) => Promise<unknown>
}

/**
 * Re-asks the wallet which accounts it exposes to this site, right before signing or sending.
 * That prompts a connect when the site was never authorized for the selected account, and catches the case where the
 * user switched accounts or wallets after connecting (the stored connection would otherwise sign with a stale address
 * and the wallet answers "not been authorized"). On a mismatch it disconnects so the user reconnects cleanly.
 */
export function useEnsureWallet() {
  const { address, connector } = useAccount()
  const { disconnectAsync } = useDisconnect()
  return useCallback(async () => {
    if (!address || !connector) return
    const provider = (await connector.getProvider()) as Eip1193 | undefined
    if (!provider?.request) return
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
    if (!accounts.some((a) => a.toLowerCase() === address.toLowerCase())) {
      await disconnectAsync().catch(() => undefined)
      throw new WalletAuthError()
    }
  }, [address, connector, disconnectAsync])
}
