# Test report

Mocked and live results are labeled separately.

## Contract unit tests (Foundry, local, mocked tokens)

`bun run contracts:test` runs 185 tests across 9 suites: all passing, including 11 fuzz tests (256 runs each) and 5 handler-based invariants.

Covers creation and signature validation, replay, deposit rounding at micro-unit boundaries (prices 1 to 5, 100e6 and 100e6 + 1), funding and expiry, completion and claim, overdue triggers at exact boundaries, dispute locking, mutual settlement for 0, partial and full refunds, reentrancy through a hostile token, fee-on-transfer rejection, banned-wallet behavior, and the invariants that the contract's USDC balance covers outstanding liabilities and credits never exceed funded amounts.

## App and API unit tests (Vitest)

`bun run test`: 19 tests passing. Cover amount split and rounding, agreement hashing, deal term validation, public ID and invitation code format, overdue predicate boundaries, time-progress clamping.

## Static checks

`bun run check` (lint plus typecheck): 0 errors, 0 warnings. A static analysis pass over the escrow reported only informational timestamp and complexity notes.

## Live end-to-end on Arc Testnet (real transactions, two throwaway funded wallets)

`bun run scripts/e2e-smoke.ts init` then `run`. 45 of 45 checks passed against the running API, the indexer and the deployed contracts.

Trade A, early dual-confirmation completion (price 1 USDC): sign-in for three accounts, invitation via token and via code, a second claim rejected, counteroffer, both signatures, escrow created (tx `0xdd0f155c...9757`), public ID assigned (`760fe49ceb8a`), stranger gets 404, exact approvals, funding (Active only after both funded), seller claims zero after declaring alone, buyer accepts early, completion credits seller 1.25 and buyer 0.25, both claimed with wallet balances rising by the credit minus gas.

Trade B, dispute then partial-refund settlement (public ID `8105bd7c11fa`, create tx `0xd3d151ef...c9c5`): funded, dispute opened and indexed as locked, settlement proposed, both signed, executed (tx `0xea80fb38...a920`), buyer credit 0.35 (0.1 refund + 0.25 deposit), seller credit 1.15 (0.9 + 0.25), both claimed. Balance reconciliation stayed correct.

An earlier run of the same script created and funded one additional escrow that remains Active (its funds, about 1.5 USDC, stay locked until its handover deadline in the throwaway wallets).

## Not covered

- Browser UI was not driven by a human with a wallet; it compiles and lints clean and uses the same endpoints and contract calls exercised above.
- No test of a live 72 hour window (the appeal is not part of this release).
- No ERC-1271 smart-wallet sign-in; the API accepts EOA signatures only.
- No load, reorg-in-production or restart-recovery test of the indexer beyond the logic itself.
