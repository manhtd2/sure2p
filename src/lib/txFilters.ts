import type { ListItem } from '@/lib/types'

export type RoleFilter = 'all' | 'buyer' | 'seller'
export type StatusFilter = 'all' | 'pending' | 'funding' | 'active' | 'disputed' | 'completed' | 'expired'

export function statusOf(item: ListItem): StatusFilter {
  if (item.kind === 'draft') return 'pending'
  switch (item.stage) {
    case 'funding':
      return 'funding'
    case 'active':
      return 'active'
    case 'disputed':
    case 'overdue':
    case 'preliminary_ruling':
    case 'appealed':
      return 'disputed'
    // A final ruling and a mutual settlement end the deal just like a normal completion.
    case 'completed':
    case 'settled':
    case 'ruled':
      return 'completed'
    case 'expired_unfunded':
      return 'expired'
    default:
      return 'active'
  }
}

/** Finished deals live under their own tabs. The default list is only what is still going on or about to start. */
const FINISHED: readonly StatusFilter[] = ['completed', 'expired']


export function matchesStatus(status: StatusFilter, item: ListItem): boolean {
  const s = statusOf(item)
  return status === 'all' ? !FINISHED.includes(s) : s === status
}
