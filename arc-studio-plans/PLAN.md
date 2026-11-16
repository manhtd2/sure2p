## Implementation Plan: sure2p (core-flow first build)

### Summary
sure2p is a P2P trade-assurance escrow dApp on Arc Testnet for primarily digital goods, with delivery happening outside the app. Buyer escrows 100% of the price plus a 25% deposit; Seller escrows a separate 25% deposit. This first build delivers the core end-to-end flow: mock-OTP + wallet sign-in, create/invite/negotiate, dual signature, funding, dual confirmation, claim, and mutual settlement. Admin, evidence, and AI Copilot are deferred.

### Architecture
- Blockchain: Arc Testnet (chainId 5042002), USDC ERC-20 only (0x3600...0000, 6 decimals). All amounts are bigint; chain facts come from `@/onchain-facts` and `@/onchain-money`. Gas and ERC-20 USDC are one balance and are shown once.
- Contract:
  - `Sure2PEscrow` (Solidity 0.8.28, OpenZeppelin 5.6.1): `createEscrow(Agreement, buyerSig, sellerSig)` with EIP-712 and registry checks; `fundBuyer`, `fundSeller`, `expireUnfunded`, `declareHandover`, `acknowledgeReceipt`, `confirmBuyerAcceptance`, `finalizeMutualCompletion`, `flagOverdue`, `openDispute`, `executeMutualSettlement`, `claim`, plus `effectiveOverdue` view. Per-escrow, per-beneficiary ledger; no sweep, no `claimTo`, no admin withdrawal.
  - `Sure2PAccountRegistry`: `isEligible(wallet)`, `setBanned(wallet, bool)` for `SECURITY_ROLE`; escrow checks both wallets on creation.
  - Deferred in this build: preliminary ruling, 72h appeal, final ruling, penalty wallet. State enum reserves them. Disputed/overdue escrows stay locked and can only exit through dual-signed mutual settlement until the Admin build; documented in docs/DECISIONS.md and shown in the UI.
- Backend (SQLite, local): `server/` Node API (Bun) with Zod; `server/indexer/` polls logs with a durable cursor, idempotent on (chainId, txHash, logIndex), confirmation depth, balance reconciliation. HttpOnly/SameSite session cookies, CSRF/origin checks, rate limits, membership check per exact escrow with a uniform 404. OTP is a labeled mock (`OTP_PROVIDER=mock`); the server refuses to start with mock when `NODE_ENV=production`.
- Frontend: Vite + React + Tailwind + wagmi/viem/ConnectKit, plus `react-router-dom`. Bilingual Vietnamese/English UI, Vietnamese default. Invite links use `buildShareLink()` with the token in the `#fragment`; QR via `qrcode`.
- Wallet: ConnectKit + injected. Sign-in needs OTP plus an EIP-4361 wallet signature (`viem/siwe`). Financial transactions are always signed and broadcast by the user's wallet, never by the server.

### Files to Create/Modify
1. `contracts/Sure2PEscrow.sol` - escrow, EIP-712, state machine, credit ledger, claim.
2. `contracts/Sure2PAccountRegistry.sol` - wallet eligibility for new escrows and ban role.
3. `contracts/interfaces/ISure2PAccountRegistry.sol` - registry interface.
4. `contracts/test/Sure2PEscrow.t.sol` - creation, funding, completion, overdue, dispute, mutual settlement tests.
5. `contracts/test/Sure2PEscrow.invariants.t.sol` - conservation and liabilities-vs-balance invariants.
6. `contracts/test/Sure2PRegistry.t.sol` - ban, roles, claim-after-ban tests.
7. `contracts/test/mocks/` - mock USDC, fee-on-transfer and hostile tokens, EIP-712 signing helpers.
8. `server/index.ts` - API bootstrap, security headers, CSRF/origin checks, rate limits.
9. `server/db.ts` - SQLite schema and migrations.
10. `server/auth/otp.ts` - labeled mock OTP: one-use, expiry, rate limit.
11. `server/auth/wallet.ts` - EIP-4361 challenge/verify and session cookies.
12. `server/routes/drafts.ts` - drafts, counteroffers, accept, immutable agreement versions, canonical hash.
13. `server/routes/invitations.ts` - hashed 256-bit tokens, manual code, QR, atomic claim, revoke, 24h expiry.
14. `server/routes/transactions.ts` - list, detail, history, balances, tx status, by publicId only.
15. `server/routes/settlements.ts` - mutual settlement proposals and EIP-712 signature collection.
16. `server/lib/agreement.ts` - canonical encoding, agreementHash, policyHash, shared typed data.
17. `server/lib/publicId.ts` - 12 lowercase hex with at least one a-f, retry on collision/all digits.
18. `server/indexer/index.ts` - log polling, cursor, reorg handling, replay, reconciliation.
19. `server/__tests__/*.test.ts` - tests for amounts, publicId, invitations, OTP, indexer.
20. `src/i18n/vi.ts`, `src/i18n/en.ts`, `src/i18n/index.tsx` - dictionaries and language switch.
21. `src/lib/api.ts`, `src/lib/escrowAbi.ts`, `src/lib/agreement.ts`, `src/lib/amounts.ts` - API client, ABI, typed data, amount math.
22. `src/pages/Landing.tsx`, `SignIn.tsx`, `Transactions.tsx`, `NewTransaction.tsx`, `Join.tsx`, `TransactionDetail.tsx` - main pages.
23. `src/components/` - RiskDisclosure, AmountBreakdown, ProgressTimeline, InviteShare (link/code/QR), AgreementDiff, TxStatusButton, ClaimPanel, SettlementPanel, MockBanner.
24. `src/hooks/` - useEscrow, useTxFlow (awaiting signature to confirmed receipt), useSession.
25. `src/App.tsx`, `src/main.tsx`, `src/config.ts`, `vite.config.ts` - router, `/api` proxy, keep `installShareSync()`.
26. `package.json`, `.env.example`, `.gitignore` - scripts, dependencies, public vs server-only env separation, secret ignores.
27. `docs/DECISIONS.md`, `docs/BUSINESS_RULES.md`, `docs/SMART_CONTRACT.md`, `docs/SECURITY.md`, `docs/TEST_REPORT.md`, `docs/DEPLOYMENT.md`, `README.md` - documentation marking what is done, deferred, and mocked.

### Build Sequence
1. Record contract design assumptions in `docs/DECISIONS.md`: per-deposit ceil rounding; signed `fundingSeconds` (24h from on-chain creation) instead of an absolute funding deadline; handoverDeadline must fall after funding expiry; no ruling/appeal in this build.
2. Write `Sure2PEscrow` and `Sure2PAccountRegistry`. Key invariants: contract USDC balance >= outstanding liabilities, credits zeroed before transfer, balance-delta checks, no admin withdrawal route.
3. Write Foundry tests per spec file 10 for this scope (rounding boundaries, signature replay, late funding, unfunded expiry, early completion, overdue without flagOverdue, mutual settlement, banned wallet can still claim). Run `forge test` until green.
4. Run a security review of the contracts and fix findings before deploying.
5. Deploy both contracts to Arc Testnet after rechecking network details against Arc docs; verify the deploy on a fork first. Record addresses in `.env` (VITE_ keys) and save the ABI. No mainnet.
6. Build the backend: SQLite schema, mock OTP, wallet challenge, sessions, CSRF and rate limits; then drafts, invitations, transactions, settlements APIs, with unit tests.
7. Build the indexer: lifecycle events, publicId assignment, balance reconciliation, restart recovery.
8. Build the frontend shell: router, i18n, sign-in (labeled mock OTP + wallet signature + Arc Testnet switch), `/transactions` and `/transactions/new` with amount breakdown (100 -> Buyer 125, Seller 25, total 150).
9. Build invite and negotiation: link, code, and QR all open `/join`; accept or counteroffer; version diff; both parties sign EIP-712 after the risk disclosure with explicit acknowledgement.
10. Build the on-chain UI flow: create escrow, exact-amount approve then fund (separate steps), illustrative progress timeline, handover declaration, receipt acknowledgement and acceptance, completion, claim with status steps (Awaiting signature, Pending tx, Confirmed receipt, Balance refreshed).
11. Build overdue, dispute, and mutual settlement UI: flagOverdue and openDispute actions, locked-state display, dual-signed settlement.
12. Final checks: `forge test`, server tests, typecheck, lint. Run an Arc Testnet smoke test if test wallets are funded; record real tx hashes only. Write `docs/TEST_REPORT.md` labeling mocked versus Testnet results.

### Done When
- [ ] `forge test` passes all contract tests, including conservation and reentrancy tests.
- [ ] Price 100 USDC yields Buyer funds 125, Seller funds 25, contract holds 150; deposits use ceil(price/4) at micro-unit boundaries.
- [ ] Escrow activates only when both sides are fully funded; after the deadline anyone can call `expireUnfunded` and funded amounts are refunded with no penalty.
- [ ] Early completion pays Seller 100% of the price, both deposits are refunded, and each wallet claims exactly once.
- [ ] Seller handover declaration alone does not start the inspection timer; `finalizeMutualCompletion` is blocked when an overdue trigger is true even if `flagOverdue` was never called.
- [ ] Dual-signed mutual settlement works for 0-100% Buyer price refund with both deposits fully refunded; bad or replayed signatures are rejected.
- [ ] A banned wallet cannot open a new escrow but can still claim existing funds.
- [ ] Link, code, and QR open the same single invitation; concurrent claims yield exactly one winner; tokens are stored hashed only.
- [ ] publicId matches the required format and is stable across restarts; non-members receive an identical 404.
- [ ] UI separates "claimable" from "received in wallet" and reports success only after receipt.status is success.
- [ ] Mock OTP is visibly labeled and the server refuses mock mode in production.
- [ ] Contracts are deployed on Arc Testnet and addresses are documented; no mainnet use.
- [ ] `docs/DECISIONS.md` lists the deferred items: Admin, rulings, appeal, penalty wallet, evidence, AI Copilot.

## Ready to build?
