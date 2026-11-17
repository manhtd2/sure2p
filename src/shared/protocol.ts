/**
 * sure2p protocol helpers shared by the API server and the browser app.
 * Pure functions only: no I/O, no environment access.
 */
import { getAddress, keccak256, toBytes, type Address, type Hex } from 'viem'

export const ARC_TESTNET_CHAIN_ID = 5042002

export const FUNDING_WINDOW_SECONDS = 24 * 60 * 60
export const MIN_DURATION_SECONDS = 60 * 60
export const MAX_DURATION_SECONDS = 30 * 24 * 60 * 60
export const DEFAULT_RESPONSE_SECONDS = 72 * 60 * 60
export const DEFAULT_INSPECTION_SECONDS = 72 * 60 * 60
export const SIGN_VALIDITY_SECONDS = 7 * 24 * 60 * 60
export const SETTLEMENT_VALIDITY_SECONDS = 24 * 60 * 60
/** Extra margin required between "now" and the funding expiry when a handover deadline is proposed. */
export const HANDOVER_MARGIN_SECONDS = 60 * 60

export const POLICY_VERSION = 'sure2p-policy-v2'

export const POLICY_TEXT = `sure2p escrow and dispute conditions (${POLICY_VERSION})
1. The Buyer deposits 100% of the goods price plus a security deposit equal to 25% of the price (rounded up to the next USDC unit). The Seller deposits a separate security deposit equal to 25% of the price (rounded up).
2. Funds are held by the sure2p smart contract and are not in the Seller's wallet before completion.
3. On valid mutual completion (Seller declares handover, Buyer accepts conforming goods) the Seller is entitled to 100% of the price, even if completed early, and both deposits are refundable in full.
4. When a deal is disputed or overdue, all funds are locked. Silence or a passed deadline never releases funds automatically.
5. Locked funds are released in one of two ways. (a) A mutual settlement signed by both parties: the price split is chosen by the parties, both deposits are refunded in full, and nobody is penalized. (b) A ruling by the Arbiter named in the smart contract. A preliminary ruling sets the price split and may penalize one party by up to 100% of that party's own deposit; the penalty is paid to a fixed penalty wallet. Either party may appeal once within 72 hours, and a different Appeal Reviewer then issues the final ruling. If nobody appeals, the preliminary ruling becomes final after 72 hours. The Arbiter and the Appeal Reviewer can only divide the funds held in this escrow between the Buyer, the Seller and the penalty wallet. If they do not act, funds stay locked until they act, the contract owner replaces them, or the parties sign a mutual settlement.
6. sure2p does not deliver, host or verify the goods. The parties exchange them outside sure2p.
7. Signing commits you to this agreement and policy version.`

export const POLICY_HASH: Hex = keccak256(toBytes(POLICY_TEXT))

/** Ceil(price / 4) in USDC base units, identical to the contract. */
export function depositFor(priceUnits: bigint): bigint {
  return (priceUnits + 3n) / 4n
}

export interface FundingBreakdown {
  price: bigint
  buyerDeposit: bigint
  sellerDeposit: bigint
  buyerFunding: bigint
  sellerFunding: bigint
  totalEscrow: bigint
}

export function fundingBreakdown(priceUnits: bigint): FundingBreakdown {
  const deposit = depositFor(priceUnits)
  return {
    price: priceUnits,
    buyerDeposit: deposit,
    sellerDeposit: deposit,
    buyerFunding: priceUnits + deposit,
    sellerFunding: deposit,
    totalEscrow: priceUnits + deposit + deposit,
  }
}

/** Business terms that both parties sign. Wallet addresses are bound separately. */
export interface DealTerms {
  title: string
  description: string
  quantity: string
  acceptanceCriteria: string
  deliveryChannel: string
  /** USDC base units as a decimal string. */
  priceUnits: string
  /** Unix seconds. */
  handoverDeadline: number
  buyerResponseSeconds: number
  inspectionSeconds: number
}

export interface PartyWallets {
  buyer: Address
  seller: Address
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Stable JSON with sorted keys, used for hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

export interface AgreementHashInput {
  terms: DealTerms
  wallets: PartyWallets
  chainId: number
  contract: Address
  nonce: string
  salt: Hex
}

/**
 * Hash committing to wallets, roles, price, deadlines, terms, policy version,
 * chain, verifying contract and a unique nonce and salt.
 */
export function computeAgreementHash(input: AgreementHashInput): Hex {
  const payload = canonicalJson({
    terms: input.terms,
    buyer: getAddress(input.wallets.buyer),
    seller: getAddress(input.wallets.seller),
    chainId: input.chainId,
    contract: getAddress(input.contract),
    nonce: input.nonce,
    salt: input.salt.toLowerCase(),
    policyVersion: POLICY_VERSION,
  })
  return keccak256(toBytes(payload))
}

/** The on-chain Agreement struct, with numeric fields as bigint. */
export interface AgreementStruct {
  buyer: Address
  seller: Address
  token: Address
  price: bigint
  buyerDeposit: bigint
  sellerDeposit: bigint
  agreementHash: Hex
  policyHash: Hex
  agreementNonce: bigint
  handoverDeadline: bigint
  buyerResponseSeconds: number
  inspectionSeconds: number
  signDeadline: bigint
}

/** JSON-safe representation (all numbers as strings) for transport. */
export interface AgreementJson {
  buyer: Address
  seller: Address
  token: Address
  price: string
  buyerDeposit: string
  sellerDeposit: string
  agreementHash: Hex
  policyHash: Hex
  agreementNonce: string
  handoverDeadline: string
  buyerResponseSeconds: number
  inspectionSeconds: number
  signDeadline: string
}

export function agreementToJson(a: AgreementStruct): AgreementJson {
  return {
    ...a,
    price: a.price.toString(),
    buyerDeposit: a.buyerDeposit.toString(),
    sellerDeposit: a.sellerDeposit.toString(),
    agreementNonce: a.agreementNonce.toString(),
    handoverDeadline: a.handoverDeadline.toString(),
    signDeadline: a.signDeadline.toString(),
  }
}

export function agreementFromJson(j: AgreementJson): AgreementStruct {
  return {
    ...j,
    price: BigInt(j.price),
    buyerDeposit: BigInt(j.buyerDeposit),
    sellerDeposit: BigInt(j.sellerDeposit),
    agreementNonce: BigInt(j.agreementNonce),
    handoverDeadline: BigInt(j.handoverDeadline),
    signDeadline: BigInt(j.signDeadline),
  }
}

export function buildAgreementStruct(args: {
  terms: DealTerms
  wallets: PartyWallets
  token: Address
  agreementHash: Hex
  agreementNonce: bigint
  signDeadline: number
}): AgreementStruct {
  const price = BigInt(args.terms.priceUnits)
  const deposit = depositFor(price)
  return {
    buyer: getAddress(args.wallets.buyer),
    seller: getAddress(args.wallets.seller),
    token: getAddress(args.token),
    price,
    buyerDeposit: deposit,
    sellerDeposit: deposit,
    agreementHash: args.agreementHash,
    policyHash: POLICY_HASH,
    agreementNonce: args.agreementNonce,
    handoverDeadline: BigInt(args.terms.handoverDeadline),
    buyerResponseSeconds: args.terms.buyerResponseSeconds,
    inspectionSeconds: args.terms.inspectionSeconds,
    signDeadline: BigInt(args.signDeadline),
  }
}

export const agreementTypes = {
  Agreement: [
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'price', type: 'uint256' },
    { name: 'buyerDeposit', type: 'uint256' },
    { name: 'sellerDeposit', type: 'uint256' },
    { name: 'agreementHash', type: 'bytes32' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'agreementNonce', type: 'uint256' },
    { name: 'handoverDeadline', type: 'uint64' },
    { name: 'buyerResponseSeconds', type: 'uint32' },
    { name: 'inspectionSeconds', type: 'uint32' },
    { name: 'signDeadline', type: 'uint64' },
  ],
} as const

export const settlementTypes = {
  Settlement: [
    { name: 'escrowId', type: 'uint256' },
    { name: 'buyerPriceRefund', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'agreementHash', type: 'bytes32' },
  ],
} as const

export interface SettlementStruct {
  escrowId: bigint
  buyerPriceRefund: bigint
  nonce: bigint
  deadline: bigint
  agreementHash: Hex
}

export interface SettlementJson {
  escrowId: string
  buyerPriceRefund: string
  nonce: string
  deadline: string
  agreementHash: Hex
}

export function settlementToJson(s: SettlementStruct): SettlementJson {
  return {
    escrowId: s.escrowId.toString(),
    buyerPriceRefund: s.buyerPriceRefund.toString(),
    nonce: s.nonce.toString(),
    deadline: s.deadline.toString(),
    agreementHash: s.agreementHash,
  }
}

export function settlementFromJson(j: SettlementJson): SettlementStruct {
  return {
    escrowId: BigInt(j.escrowId),
    buyerPriceRefund: BigInt(j.buyerPriceRefund),
    nonce: BigInt(j.nonce),
    deadline: BigInt(j.deadline),
    agreementHash: j.agreementHash,
  }
}

export function eip712Domain(chainId: number, verifyingContract: Address) {
  return {
    name: 'Sure2PEscrow',
    version: '2',
    chainId,
    verifyingContract: getAddress(verifyingContract),
  } as const
}

/** Public ID format: exactly 12 lowercase hex characters containing at least one a-f. */
export const PUBLIC_ID_REGEX = /^(?=.*[a-f])[0-9a-f]{12}$/

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_REGEX.test(value)
}

/** Business states derived from indexed events. */
export type EscrowStage =
  | 'funding'
  | 'active'
  | 'overdue'
  | 'disputed'
  | 'preliminary_ruling'
  | 'appealed'
  | 'completed'
  | 'settled'
  | 'ruled'
  | 'expired_unfunded'

/** Appeal window after a preliminary ruling. Mirrors Sure2PEscrowV2.APPEAL_WINDOW. */
export const APPEAL_WINDOW_SECONDS = 72 * 60 * 60

/** Mirrors the contract's Fault enum. */
export const FAULT = { none: 0, buyer: 1, seller: 2 } as const
export type FaultCode = 0 | 1 | 2

/** Stages in which a case is open for evidence and admin attention. */
export const OPEN_CASE_STAGES: readonly EscrowStage[] = ['overdue', 'disputed', 'preliminary_ruling', 'appealed']

export type OverdueTrigger = 0 | 1 | 2 | 3

/**
 * Mirror of the contract's overdue predicate so the UI can show the effective
 * state before anyone calls flagOverdue. The chain remains the source of truth.
 */
export function overdueTriggerAt(
  nowSec: number,
  e: {
    handoverDeadline: number
    buyerResponseSeconds: number
    inspectionSeconds: number
    sellerHandoverDeclared: boolean
    sellerDeclaredAt: number
    buyerReceiptAcknowledged: boolean
    buyerAcknowledgedAt: number
    buyerAccepted: boolean
  },
): OverdueTrigger {
  if (!e.sellerHandoverDeclared && nowSec > e.handoverDeadline) return 1
  if (
    e.sellerHandoverDeclared &&
    !e.buyerReceiptAcknowledged &&
    nowSec > e.sellerDeclaredAt + e.buyerResponseSeconds
  )
    return 2
  if (e.buyerReceiptAcknowledged && !e.buyerAccepted && nowSec > e.buyerAcknowledgedAt + e.inspectionSeconds) return 3
  return 0
}

/** Illustrative time progress, 0..1. Never a payment or vested balance. */
export function timeProgress(nowSec: number, activatedAt: number, handoverDeadline: number): number {
  const span = handoverDeadline - activatedAt
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (nowSec - activatedAt) / span))
}
