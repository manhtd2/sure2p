import { describe, expect, it } from 'vitest'
import { getAddress, type Hex } from 'viem'
import {
  POLICY_HASH,
  PUBLIC_ID_REGEX,
  agreementFromJson,
  agreementToJson,
  buildAgreementStruct,
  canonicalJson,
  computeAgreementHash,
  depositFor,
  fundingBreakdown,
  isPublicId,
  overdueTriggerAt,
  timeProgress,
  type DealTerms,
} from '../../src/shared/protocol.js'
import { dealTermsSchema, handoverDeadlineError } from '../../src/shared/validation.js'
import { generatePublicId, newDraftRef, normalizeInviteCode, randomInviteCode } from '../lib/ids.js'
import { formatUsdc, parseUsdc } from '../../src/onchain-money.js'

const BUYER = getAddress('0x1111111111111111111111111111111111111111')
const SELLER = getAddress('0x2222222222222222222222222222222222222222')
const CONTRACT = getAddress('0xcdaf4bc89d9e44eac1c36d9ee01724e5e51d90b9')
const SALT = `0x${'ab'.repeat(32)}` as Hex

const terms: DealTerms = {
  title: 'Logo set',
  description: 'A set of vector logo files delivered by email.',
  quantity: '1',
  acceptanceCriteria: 'Files open and match the preview.',
  deliveryChannel: 'Email',
  priceUnits: '100000000',
  handoverDeadline: 1_800_000_000,
  buyerResponseSeconds: 259_200,
  inspectionSeconds: 259_200,
}

const hashOf = (t: DealTerms, nonce = '1', salt: Hex = SALT) =>
  computeAgreementHash({ terms: t, wallets: { buyer: BUYER, seller: SELLER }, chainId: 5042002, contract: CONTRACT, nonce, salt })

describe('amount precision', () => {
  it('splits a 100 USDC price into 125 / 25 / 150', () => {
    const b = fundingBreakdown(parseUsdc('100'))
    expect(formatUsdc(b.buyerFunding)).toBe('125')
    expect(formatUsdc(b.sellerFunding)).toBe('25')
    expect(formatUsdc(b.totalEscrow)).toBe('150')
  })

  it('rounds each deposit up independently at micro-unit boundaries', () => {
    expect(depositFor(1n)).toBe(1n)
    expect(depositFor(2n)).toBe(1n)
    expect(depositFor(3n)).toBe(1n)
    expect(depositFor(4n)).toBe(1n)
    expect(depositFor(5n)).toBe(2n)
    expect(depositFor(100_000_001n)).toBe(25_000_001n)
  })

  it('never loses a unit: totals equal price plus both deposits', () => {
    for (const p of [1n, 7n, 999_999n, 1_000_001n, 12_345_678n]) {
      const b = fundingBreakdown(p)
      expect(b.buyerFunding + b.sellerFunding).toBe(b.totalEscrow)
      expect(b.totalEscrow).toBe(p + 2n * depositFor(p))
    }
  })

  it('rejects more than 6 decimals instead of truncating', () => {
    expect(() => parseUsdc('1.1234567')).toThrow()
    expect(parseUsdc('0.000001')).toBe(1n)
  })
})

describe('agreement hashing', () => {
  it('is deterministic and independent of key order', () => {
    const reordered = Object.fromEntries(Object.entries(terms).reverse()) as unknown as DealTerms
    expect(hashOf(terms)).toBe(hashOf(reordered))
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('changes when any economic or identity input changes', () => {
    const base = hashOf(terms)
    expect(hashOf({ ...terms, priceUnits: '100000001' })).not.toBe(base)
    expect(hashOf({ ...terms, handoverDeadline: terms.handoverDeadline + 1 })).not.toBe(base)
    expect(hashOf(terms, '2')).not.toBe(base)
    expect(hashOf(terms, '1', `0x${'cd'.repeat(32)}`)).not.toBe(base)
    const swapped = computeAgreementHash({ terms, wallets: { buyer: SELLER, seller: BUYER }, chainId: 5042002, contract: CONTRACT, nonce: '1', salt: SALT })
    expect(swapped).not.toBe(base)
    const otherChain = computeAgreementHash({ terms, wallets: { buyer: BUYER, seller: SELLER }, chainId: 1, contract: CONTRACT, nonce: '1', salt: SALT })
    expect(otherChain).not.toBe(base)
  })

  it('builds the on-chain struct with exact deposits and survives a JSON round trip', () => {
    const struct = buildAgreementStruct({ terms, wallets: { buyer: BUYER, seller: SELLER }, token: CONTRACT, agreementHash: hashOf(terms), agreementNonce: 7n, signDeadline: 1_790_000_000 })
    expect(struct.buyerDeposit).toBe(25_000_000n)
    expect(struct.sellerDeposit).toBe(25_000_000n)
    expect(struct.policyHash).toBe(POLICY_HASH)
    expect(agreementFromJson(agreementToJson(struct))).toEqual(struct)
  })
})

describe('deal terms validation', () => {
  it('rejects a zero price, a tiny description and out-of-range durations', () => {
    expect(dealTermsSchema.safeParse({ ...terms, priceUnits: '0' }).success).toBe(false)
    expect(dealTermsSchema.safeParse({ ...terms, description: 'short' }).success).toBe(false)
    expect(dealTermsSchema.safeParse({ ...terms, inspectionSeconds: 60 }).success).toBe(false)
    expect(dealTermsSchema.safeParse(terms).success).toBe(true)
  })

  it('needs 25 hours between now and the handover deadline', () => {
    const now = 1_000_000
    expect(handoverDeadlineError(now + 25 * 3600, now)).not.toBeNull()
    expect(handoverDeadlineError(now + 25 * 3600 + 1, now)).toBeNull()
  })
})

describe('public ids and invitation codes', () => {
  it('always yields 12 lowercase hex characters with at least one a-f', () => {
    for (let i = 0; i < 2000; i++) {
      const id = generatePublicId()
      expect(PUBLIC_ID_REGEX.test(id)).toBe(true)
      expect(isPublicId(id)).toBe(true)
    }
  })

  it('rejects all-digit, uppercase, short and sequential-looking ids', () => {
    expect(isPublicId('123456789012')).toBe(false)
    expect(isPublicId('ABCDEF123456')).toBe(false)
    expect(isPublicId('abcdef12345')).toBe(false)
    expect(isPublicId('000000000001')).toBe(false)
    expect(isPublicId('00000000000a')).toBe(true)
  })

  it('keeps leading zeros in a public id', () => {
    expect(isPublicId('0000a1b2c3d4')).toBe(true)
  })

  it('draft references are not public ids', () => {
    for (let i = 0; i < 50; i++) expect(isPublicId(newDraftRef())).toBe(false)
  })

  it('invitation codes are 80 bits, formatted, and normalize forgiving typos', () => {
    const code = randomInviteCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
    expect(normalizeInviteCode(code.toLowerCase())).toBe(code.replace(/-/g, ''))
    expect(normalizeInviteCode('o1il')).toBe('0111')
    const seen = new Set(Array.from({ length: 500 }, () => randomInviteCode()))
    expect(seen.size).toBe(500)
  })
})

describe('overdue predicate (mirrors the contract, strict greater-than)', () => {
  const base = {
    handoverDeadline: 1000,
    buyerResponseSeconds: 100,
    inspectionSeconds: 200,
    sellerHandoverDeclared: false,
    sellerDeclaredAt: 0,
    buyerReceiptAcknowledged: false,
    buyerAcknowledgedAt: 0,
    buyerAccepted: false,
  }

  it('trigger 1: no handover by the deadline', () => {
    expect(overdueTriggerAt(1000, base)).toBe(0)
    expect(overdueTriggerAt(1001, base)).toBe(1)
  })

  it('trigger 2: buyer silent after the seller declares', () => {
    const s = { ...base, sellerHandoverDeclared: true, sellerDeclaredAt: 500 }
    expect(overdueTriggerAt(600, s)).toBe(0)
    expect(overdueTriggerAt(601, s)).toBe(2)
  })

  it('trigger 3: acknowledged but not accepted within the inspection window', () => {
    const s = { ...base, sellerHandoverDeclared: true, sellerDeclaredAt: 500, buyerReceiptAcknowledged: true, buyerAcknowledgedAt: 520 }
    expect(overdueTriggerAt(720, s)).toBe(0)
    expect(overdueTriggerAt(721, s)).toBe(3)
  })

  it('never triggers once the buyer accepted', () => {
    const s = { ...base, sellerHandoverDeclared: true, sellerDeclaredAt: 500, buyerReceiptAcknowledged: true, buyerAcknowledgedAt: 520, buyerAccepted: true }
    expect(overdueTriggerAt(10_000_000, s)).toBe(0)
  })
})

describe('time progress visualization', () => {
  it('clamps to 0..1 and never exceeds the span', () => {
    expect(timeProgress(0, 100, 200)).toBe(0)
    expect(timeProgress(150, 100, 200)).toBe(0.5)
    expect(timeProgress(900, 100, 200)).toBe(1)
    expect(timeProgress(150, 200, 200)).toBe(1)
  })
})
