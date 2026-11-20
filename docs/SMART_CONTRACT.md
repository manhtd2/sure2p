# Smart contracts

Solidity 0.8.28, EVM target Cancun, OpenZeppelin 5.6.1. Arc Testnet only.

## Sure2PEscrowV3 (current)

Replaces the V2 single-fault ruling with a per-party ruling: price refund, a deposit refund and fault and fraud flag for each side, committed to the escrow's agreement hash, a reason hash and an evidence root. Both deposits can be penalised in one ruling; a side not at fault always gets its full deposit back. `fraudConfirmed(id)` exposes fraud flags only from the effective ruling after finalization. Owner, arbiter and reviewer are always distinct; the penalty wallet may equal the owner (recorded exception). The EIP-712 domain version is `3`. Full design: `contracts/Sure2PEscrowV3-design.md`.

## Sure2PEscrowV2 (retired)

Extends V1 with rulings, one appeal, penalties and evidence anchors. Domain version `2`. Replaced by V3; it holds no escrows and no funds. Design: `contracts/Sure2PEscrowV2-design.md`.

- Roles: `owner` (two-step, cannot renounce) replaces `arbiter` and `appealReviewer`. They must differ from each other and from the immutable `penaltyWallet`, and none of owner, arbiter, reviewer or penalty wallet may be a party of a new escrow.
- `issuePreliminaryRuling(id, buyerPriceRefund, fault, penalty, reasonHash)`: arbiter, from Overdue or Disputed. Penalty is at most the at-fault side's own deposit.
- `appeal(id, reasonHash)`: a party, once, up to and including the 72 hour deadline. `finalizeRuling(id)`: anyone, strictly after the deadline if not appealed.
- `issueFinalRuling(...)`: appeal reviewer, never the address that issued the preliminary ruling.
- `anchorEvidence(id, hash)`: a party, event only.
- `executeMutualSettlement` also works during PreliminaryRuling and Appealed.
- Credits go only to buyer, seller or the penalty wallet and always sum to price plus both deposits.

States: None, Funding, Active, Overdue, Disputed, PreliminaryRuling, Appealed, Finalized, ExpiredUnfunded.

## Sure2PEscrow (V1, retired)

USDC-only escrow, immutable configuration (USDC address, registry address), no owner.

- Creation: `createEscrow(Agreement, buyerSig, sellerSig)`. Checks both signatures, registry eligibility of both wallets, token is the configured USDC, exact deposits, unused agreement hash and per-buyer nonce, bounds on durations, handover deadline later than the 24 hour funding window.
- Funding: `fundBuyer`, `fundSeller` (exact transfer, balance delta checked), `expireUnfunded`.
- Completion: `declareHandover`, `acknowledgeReceipt`, `confirmBuyerAcceptance`, `finalizeMutualCompletion`.
- Locks: `flagOverdue`, `openDispute`, view `effectiveOverdue` and `overdueTrigger`.
- Release: `executeMutualSettlement(Settlement, buyerSig, sellerSig)` and `claim`.
- Accounting: per escrow credit ledger plus `totalOutstanding`. The contract's USDC balance must always be at least `totalOutstanding`.

States: None, Funding, Active, Overdue, Disputed, PreliminaryRuling (reserved), Appealed (reserved), Finalized, ExpiredUnfunded.

EIP-712 domain: name `Sure2PEscrow`, version `1`. Type strings:

```
Agreement(address buyer,address seller,address token,uint256 price,uint256 buyerDeposit,uint256 sellerDeposit,bytes32 agreementHash,bytes32 policyHash,uint256 agreementNonce,uint64 handoverDeadline,uint32 buyerResponseSeconds,uint32 inspectionSeconds,uint64 signDeadline)
Settlement(uint256 escrowId,uint256 buyerPriceRefund,uint256 nonce,uint64 deadline,bytes32 agreementHash)
```

## Sure2PAccountRegistry

`isEligible(wallet)` is false for banned wallets. `setBanned` and `setBannedBatch` need the security role. Banned wallets cannot create new escrows but can still fund, confirm, settle and claim on existing ones. No phone data is stored.

## Deployments (Arc Testnet)

| Contract | Address |
|---|---|
| Sure2PEscrowV3 (current) | 0xab91b5239f65d9f125d0a1d5d93350f257dba33c |
| Sure2PEscrowV2 (retired, empty) | 0xbac54f5f54516007b5db955ee45433920893d94a |
| Sure2PEscrow (V1, retired from the app) | 0xcdaf4bc89d9e44eac1c36d9ee01724e5e51d90b9 |
| Sure2PAccountRegistry | 0xfa6a19d4597a55f1f64003fb28fba199f8bafacd |
| USDC (existing) | 0x3600000000000000000000000000000000000000 |

V3 deployment transaction: `0xffb3b587a9249b2110015072273202e57254a7102902794147c96a7dedf6141e`. V2 deployment transaction: `0x3da72eb58a398e576a02a4f8d6635998ee346c59b6c30ece9d15f49eaddccb08`. V1 escrow deployment transaction: `0x422002da4274996918369fd3758a929b0ff98607cadab927453fd78e6261bf11`. Registry deployment transaction: `0xf367e3c8a152940ac66fd1dd4dd309e7bba6cc08b026fd49e75187f129f23399`.

The contracts have had an internal security review and a unit test suite, not an independent third-party audit.
