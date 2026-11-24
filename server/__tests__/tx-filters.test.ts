import { describe, expect, it } from 'vitest'
import { matchesStatus } from '../../src/lib/txFilters'
import type { ListItem } from '../../src/lib/types'

const draft = (status: string) => ({ kind: 'draft', status }) as unknown as ListItem
const escrow = (stage: string) => ({ kind: 'escrow', stage }) as unknown as ListItem

describe('transaction list tabs', () => {
  it('the default tab shows only invitations, running and upcoming deals', () => {
    for (const i of [draft('draft'), draft('invited'), draft('negotiating'), draft('ready'), draft('submitted'), escrow('funding'), escrow('active'), escrow('overdue'), escrow('disputed'), escrow('preliminary_ruling'), escrow('appealed')]) {
      expect(matchesStatus('all', i)).toBe(true)
    }
  })

  it('finished deals never appear in the default tab and appear in their own', () => {
    for (const stage of ['completed', 'settled', 'ruled']) {
      expect(matchesStatus('all', escrow(stage))).toBe(false)
      expect(matchesStatus('completed', escrow(stage))).toBe(true)
    }
    expect(matchesStatus('all', escrow('expired_unfunded'))).toBe(false)
    expect(matchesStatus('expired', escrow('expired_unfunded'))).toBe(true)
  })

  it('a deal under ruling or appeal is a dispute, not a pending invitation or a finished deal', () => {
    for (const stage of ['preliminary_ruling', 'appealed']) {
      expect(matchesStatus('disputed', escrow(stage))).toBe(true)
      expect(matchesStatus('pending', escrow(stage))).toBe(false)
      expect(matchesStatus('completed', escrow(stage))).toBe(false)
    }
  })

  it('every deal is in exactly one specific tab', () => {
    const tabs = ['pending', 'funding', 'active', 'disputed', 'completed', 'expired'] as const
    for (const i of [draft('draft'), escrow('funding'), escrow('active'), escrow('overdue'), escrow('ruled'), escrow('settled'), escrow('expired_unfunded'), escrow('appealed')]) {
      expect(tabs.filter((t) => matchesStatus(t, i))).toHaveLength(1)
    }
  })
})
