# Smart contracts

Solidity 0.8.28, EVM target Cancun, OpenZeppelin 5.6.1. Arc Testnet only.

## Sure2PEscrow

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
| Sure2PEscrow | 0xcdaf4bc89d9e44eac1c36d9ee01724e5e51d90b9 |
| Sure2PAccountRegistry | 0xfa6a19d4597a55f1f64003fb28fba199f8bafacd |
| USDC (existing) | 0x3600000000000000000000000000000000000000 |

Escrow deployment transaction: `0x422002da4274996918369fd3758a929b0ff98607cadab927453fd78e6261bf11`. Registry deployment transaction: `0xf367e3c8a152940ac66fd1dd4dd309e7bba6cc08b026fd49e75187f129f23399`.

The contracts have had an internal security review and a unit test suite, not an independent third-party audit.
