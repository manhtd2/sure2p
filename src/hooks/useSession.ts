import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'

export function useSession() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    staleTime: 10_000,
    retry: false,
  })
  return {
    me: query.data,
    loading: query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    signedIn: Boolean(query.data?.authenticated),
    hasWallet: Boolean(query.data?.authenticated && query.data.wallet),
  }
}
