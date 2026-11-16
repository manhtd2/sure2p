import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { CHAIN_ID } from '@/lib/contracts'

/** Financial pages need a verified phone account AND a signed wallet on Arc Testnet. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, hasWallet } = useSession()
  const location = useLocation()
  if (loading) {
    return (
      <div className="flex justify-center py-20 text-[var(--muted)]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }
  if (!hasWallet || me?.chainId !== CHAIN_ID) {
    return <Navigate to={`/sign-in?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  return <>{children}</>
}
