# Decisions and assumptions

Recorded where the build made a choice, filled a gap, or deviates from the product spec. Frozen economic rules were not changed.

## Scope of this release

- Built: contracts, API, indexer, and the core user flow (sign in, create, invite, negotiate, sign, create escrow, fund, confirm, claim, overdue, dispute lock, mutual settlement).
- Deferred to later releases: Admin console and rulings, the 72 hour appeal, deposit penalties and the penalty wallet, evidence upload, the AI assistant, notifications.
- Consequence: a disputed or overdue escrow can only be released by a mutual settlement signed by both parties. If they never agree, funds stay locked. The contract has reserved `PreliminaryRuling` and `Appealed` states with no transitions yet. Adding rulings will need a new escrow contract version; existing escrows stay on this one.
- Users are told this in the risk disclosure, on the landing page and next to every locked deal.

## Contract design

- Funding window: a constant 24 hours from confirmed creation (not signed), so the signed agreement carries only the absolute handover deadline, which must be later than creation time plus 24 hours.
- Each deposit is `ceil(price / 4)`, computed independently for both sides.
- Agreement and settlement signatures use EIP-712 with ERC-1271 support in the contract. The API verifies only EOA signatures when it records them.
- `openDispute` is rejected once the Buyer has accepted. Found in review: otherwise a Buyer could accept and then immediately dispute, blocking the Seller's earned payout behind a second signature.
- No admin, owner, sweep, rescue or `claimTo` exists on the escrow. The registry is the only administered contract.
- The registry admin and security role were set to the Arc Studio platform deployer wallet because the platform deploys from it. That wallet is not controlled by the project owner. Before real use, grant the security role to an operator wallet or multisig and revoke the platform wallet.

## Backend

- Vite stays for the UI and a separate Bun API with SQLite serves drafts, invitations and history (the spec allows SQLite for local runs). Next.js and PostgreSQL were not adopted.
- Phone verification is a mock provider. The code is returned to the caller and shown in a labeled box. The server refuses to start with it when `NODE_ENV=production`.
- Phone numbers are stored encrypted and indexed by a keyed hash. Nothing phone-related is sent onchain.
- Cookies are HttpOnly and SameSite. The Arc Studio preview proxy drops custom headers except `X-Requested-With`, so that header is the CSRF marker, combined with an origin check.
- A draft stores terms without wallets. When the counterparty claims the invitation both wallets become known and the agreement hash is computed for the open versions (they hold no signatures yet).
- Invitation: 256-bit token plus an 80-bit manual code, both stored only as keyed hashes, 24 hour expiry, one atomic claim. The QR encodes the same link. The token travels in the URL fragment and is kept in session storage only while the visitor signs in.
- Public IDs: 12 lowercase hex characters containing at least one a-f, from a secure random source, retried on collision.
- Indexer: starts from the deployment block, never block 0; bounded `getLogs` ranges; idempotent on `(chainId, txHash, logIndex)`; reorg detection by cursor block hash with reset and full replay; USDC balance versus outstanding liability reconciliation every 30 seconds.
- The sandbox RPC proxy refuses raw transaction broadcasts, so the end-to-end script sends writes through the public Arc Testnet RPC and reads through the proxy.

## Not verified

- The browser UI has not been exercised by a human with a wallet in the preview. It compiles, passes lint and typecheck, and its API and contract flow is covered by the end-to-end script that drives the same endpoints and contract calls.
