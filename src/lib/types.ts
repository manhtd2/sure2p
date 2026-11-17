import type { AgreementJson, DealTerms, EscrowStage, SettlementJson } from '@/shared/protocol'

export interface Me {
  authenticated: boolean
  otpProvider: string
  accountId?: string
  accountStatus?: 'active' | 'banned' | 'limited'
  wallet?: string | null
  chainId?: number | null
  contracts?: { escrow: `0x${string}`; registry: `0x${string}`; usdc: `0x${string}` }
}

export interface DraftVersionView {
  id: string
  version: number
  proposedByMe: boolean
  terms: DealTerms
  status: 'open' | 'superseded' | 'executed'
  agreementHash: string | null
  signDeadline: number
  agreement: AgreementJson | null
  buyerSigned: boolean
  sellerSigned: boolean
  buyerSig: string | null
  sellerSig: string | null
  createdAt: number
}

export interface DraftView {
  id: string
  status: string
  myRole: 'buyer' | 'seller'
  creatorRole: 'buyer' | 'seller'
  isCreator: boolean
  buyerWallet: string | null
  sellerWallet: string | null
  claimed: boolean
  createTxHash: string | null
  publicId: string | null
  createdAt: number
  updatedAt: number
  invitation: { id: string; expiresAt: number; revoked: boolean; claimed: boolean; expired: boolean } | null
  versions: DraftVersionView[]
}

export interface EscrowView {
  kind: 'escrow'
  publicId: string
  onChainId: string
  draftRef: string | null
  myRole: 'buyer' | 'seller'
  stage: EscrowStage
  buyerWallet: string
  sellerWallet: string
  price: string
  buyerDeposit: string
  sellerDeposit: string
  agreementHash: string
  policyHash: string
  createdAt: number
  fundingDeadline: number
  handoverDeadline: number
  buyerResponseSeconds: number
  inspectionSeconds: number
  buyerFunded: boolean
  sellerFunded: boolean
  activatedAt: number | null
  sellerDeclaredAt: number | null
  handoverManifest: string | null
  buyerAcknowledgedAt: number | null
  buyerAcceptedAt: number | null
  flaggedTrigger: number
  effectiveOverdueTrigger: number
  disputeOpenedBy: string | null
  settlementNonce: number
  settledBuyerRefund: string | null
  creationTx: string
  ruling: RulingView | null
  terms: DealTerms | null
  title?: string | null
}

export interface RulingDecisionView {
  by: string
  buyerPriceRefund: string
  fault: 0 | 1 | 2
  penalty: string
  reasonHash: string
}

export interface RulingView {
  notes: Record<string, string>
  prelim: (RulingDecisionView & { at: number; appealDeadline: number }) | null
  appeal: { by: string; at: number; reasonHash: string } | null
  final: (RulingDecisionView & { at: number; byAppeal: boolean }) | null
}

export interface EvidenceFile {
  id: string
  filename: string
  mime: string
  size: number
  sha256: string
  note: string | null
  uploadedBy: 'buyer' | 'seller'
  createdAt: number
  anchored: { txHash: string; at: number } | null
}

export interface AdminCase extends Omit<EscrowView, 'myRole'> {
  myRole: 'admin'
  role: 'arbiter' | 'reviewer'
  /** True when the signed-in admin wallet is a party of this deal; the contract rejects its ruling. */
  isParty: boolean
  evidence: EvidenceFile[]
  history: HistoryEvent[]
}

export interface DraftListItem {
  kind: 'draft'
  ref: string
  status: string
  title: string
  price: string
  myRole: 'buyer' | 'seller'
  updatedAt: number
}

export type ListItem = DraftListItem | EscrowView

export interface HistoryEvent {
  name: string
  blockNumber: number
  timestamp: number
  txHash: string
  logIndex: number
  args: Record<string, string>
}

export interface Balances {
  source: 'chain'
  blockNumber: string
  onChainState: number
  priceLocked: string
  buyerFundedAmount: string
  sellerFundedAmount: string
  claimable: string
  withdrawableBeforeConfirmation: string
}

export interface SettlementProposalView {
  id: string
  status: 'open' | 'superseded' | 'executed'
  settlement: SettlementJson
  buyerSig: string | null
  sellerSig: string | null
  expired: boolean
  createdAt: number
}
