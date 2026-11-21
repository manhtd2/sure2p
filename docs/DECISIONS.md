# Decisions and assumptions

Recorded where the build made a choice, filled a gap, or deviates from the product spec. Frozen economic rules were not changed.

## Scope of this release

- Built: contracts, API, indexer, and the core user flow (sign in, create, invite, negotiate, sign, create escrow, fund, confirm, claim, overdue, dispute lock, mutual settlement).
- Phase 2 (this release): escrow V2 with Arbiter rulings, one 72 hour appeal, deposit penalties to an immutable penalty wallet, evidence upload with optional onchain hash anchors, and an admin console at `/admin`.
- Deferred: notifications and the AI Copilot.
- V1 to V2 cutover: the app and indexer now follow V2 only. The 3 V1 test escrows (1.5 USDC outstanding) no longer appear in the app. They remain on the V1 contract, where parties can still call `claim` or settle directly. The design doc originally planned dual-contract support; it was dropped for testnet to keep the indexer and UI simple.
- Admin sign-in reuses the existing phone code plus wallet signature, then checks the wallet against the contract's current `arbiter` and `appealReviewer`. Access follows the chain, so replacing a role holder moves access immediately.
- Rulings are sent from the admin's own wallet. Written reasons are stored in the database by hash (`case_notes`); only the hash goes onchain.
- Evidence bytes are stored in the database (2 MB cap) so a serverless deploy needs no extra storage service.
- The signed policy text is now `sure2p-policy-v2` and describes rulings, appeal and penalties. Agreements signed under v1 are not affected.
- Description files: the file hashes are put in the signed terms rather than stored separately, so locking follows from the existing signature and the agreement hash already recorded onchain; no contract change was needed. Bytes live in the database (3 MB per file because the upload goes through a 4.5 MB serverless request). The signed policy text was not changed.
- Penalty wallet equals the owner address by your choice. The owner cannot rule or move funds.

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

## Open questions from the 10-part spec (2026-11-20)

Nothing below has been decided; no value has been invented. See `docs/SPEC_GAP.md` for the full gap list.

- Contract: the spec's two-sided deposit refund and fraud flags need a new escrow contract at a new address (V2 stays as deployed). Waiting for owner approval before any build or deploy.
- Owner and penalty wallet are the same address by explicit owner choice; the spec asks for four distinct addresses (D05).
- Registry role is still held by the shared platform deployer wallet; only the project owner's wallet can move it.
- D01 to D15 are all open. Policy and legal pages will be built with blank, labelled placeholders until D01, D02, D03 and D10 are answered.
- Evidence limits (spec: 2 MB, 25 files, PNG/JPEG/WebP/PDF/text) differ from what is live (office files allowed, 3 MB description files); pending D09.

## Answers on 2026-11-20

- Contract: build a V3 escrow that matches the spec (per-party deposit refunds, fraud flags), deploy at a new address on Arc Testnet, switch the app to it. V2 escrows will no longer show in the app. Not started: needs a design doc and owner confirmation first.
- Owner and penalty wallet stay the same address (`0xEb8d...7253e`), recorded as a deliberate exception to the spec's four distinct addresses.
- Build order: public pages first (done), then contract V3, admin split, account page.
- Providers (D04): keep the labelled mock OTP and keep evidence in the database; the AI assistant is out of scope for this round and docs say so.
- English translation of docs and policies is pending D10; the UI chrome is bilingual, long-form text is Vietnamese with a notice.
- The V2 contract source is not verified on the explorer; the Trust page says so.

## Sure2PEscrowV3 written and reviewed (2026-11-20)

- Source: `contracts/Sure2PEscrowV3.sol`, from the approved `contracts/Sure2PEscrowV3-design.md`. Not deployed yet; waiting for the owner's final OK on the constructor arguments.
- Review at maximum depth, two rounds. Round 1 fixed one low item (ruling errors now carry context). Round 2 left one low item (older errors such as `InvalidDuration` and `InvalidConfiguration` carry no values; same as V2, diagnostic only, accepted).
- Open point for the owner: one functional finding rated high reads the spec as "fraud flags must not be visible before a final ruling". The approved design lets the parties see the flags in the preliminary ruling and only treats a final ruling as confirmed fraud (`fraudConfirmed`). Kept as designed; changing it needs a design change (salted commitment, reveal at finalization).
- Tests: 184 new V3 tests, full suite 519 passing. Static analysis: no high or medium findings (8 low timestamp notes for the 24h and 72h windows, expected).
- Contract size 22,800 bytes deploy size; 20,654 bytes runtime.
- Dead code noted by the tester: the `AlreadyAppealed` branch is unreachable because the state check reverts first. Harmless.

## Sure2PEscrowV3 deployed (2026-11-20)

- Address `0xab91b5239f65d9f125d0a1d5d93350f257dba33c`, tx `0xffb3b587a9249b2110015072273202e57254a7102902794147c96a7dedf6141e`, Arc Testnet. Roles read back from the chain: owner and penalty wallet `0xEb8d...7253e`, arbiter `0x3026...FEB6`, appeal reviewer `0x835E...A88E`, USDC `0x3600...0000`, registry `0xFa6A...FACD` (reused).
- The owner approved the deploy and the preliminary-ruling fraud-flag visibility as designed.
- The app now reads V3. V2 had 0 escrows and 0 outstanding funds, so nothing was stranded. The V3 source is not verified on the explorer.
- App changes: new ABI, EIP-712 domain version 3, `ruling_decisions` projection table (JSON decision fields), per-party ruling form and summary. Post-deploy integration tests were offered and not run.
- Still open: registry `SECURITY_ROLE` is held by the shared platform deployer wallet; ban flow, admin split and account page are not built yet.

## V3 end-to-end run (2026-11-20)

- Ran `scripts/e2e-smoke.ts` against the V3 contract with two throwaway wallets funded from the faucet: 45 of 45 checks passed (create, fund, handover, early completion, claims, dispute, dual-signed settlement, reconciliation). The run used the local API; the live API could not be driven yet because the production deploy returns 404 for `POST /api/drafts/:id/invitations` (the nested path has no function file under the 12-function limit). Fixed by moving it to `POST /api/drafts/:id?action=invitations`; needs a push and redeploy, then the same script is re-run with `E2E_API=https://sure2p.vercel.app/api`.
- Not exercised: Arbiter and Appeal Reviewer transactions (their keys are held by the owner). Those paths are covered by the 184 V3 contract tests only.
- The script now polls for the post-claim balance, because the RPC node serving a read can lag the receipt by a block.

## Admin split and ban flow (2026-11-20)

- Admin console is now `/admin` (overview), `/admin/cases`, `/admin/cases/:id`, `/admin/appeals`, `/admin/escrows`, `/admin/accounts`, `/admin/audit`, `/admin/settings`. New server reads: `/admin/overview`, `/admin/audit`, `/admin/accounts`; the ban/unban write is `POST /admin/accounts?action=ban|unban`. All are single-segment, so no new Vercel function.
- Ban rules: only the registry SECURITY_ROLE holder may act; the contract's `fraudConfirmed` must name that side from a final ruling; the app-level ban sets the account status to banned (blocks new deals only). The wallet-level ban is a separate `setBanned` transaction from the security admin's own wallet.
- BLOCKER (needs the owner): on the current registry, SECURITY_ROLE and DEFAULT_ADMIN_ROLE are held by the shared platform deployer wallet `0x5B12...Ef42`, and the owner wallet holds neither (read from the chain). Nobody on the owner's side can ban or move the role, and the registry is immutable inside V3. Options: (a) deploy a new registry owned by the owner plus a new escrow (V4) that points to it, (b) accept that bans are unusable on this deployment, (c) let the owner wallet act as security admin for the app-level ban only (a design change). Not decided.
- Found while testing the live deploy: the draft page never triggered the lazy indexer, so a new escrow's public ID could stay missing on Vercel until another page was opened. Fixed in `server/http.ts`; needs a redeploy.

## Security admin = owner wallet (decided 2026-11-20, option 3)

- The app-level account ban is executed by the escrow contract's `owner()` wallet (read from the chain). It sets `accounts.status = 'banned'`, which blocks starting or joining new deals (HTTP 403 `account_restricted`), and nothing else: reads and claims still work.
- A ban needs the contract's `fraudConfirmed(id)` to name that side, which only a final ruling can do.
- Nothing is written to the registry. The registry SECURITY_ROLE stays with the shared platform wallet and is not used. This is a deliberate deviation from the spec (security admin separate from the owner, wallet-level ban). Concentration of power: the owner can already replace the arbiter and reviewer, and now also bans accounts after a final ruling.
- To reach the spec fully later: deploy a registry owned by the project wallet and redeploy the V3 bytecode pointing to it (option 1).

## Assistant, notifications, evidence vault, English (decided 2026-11-21)

- Assistant: 12 tools (4 read, 8 prepare), previews stored in `action_previews`, 300 second expiry, one account and wallet, re-validated at confirm (a changed state makes the preview stale). Server-side writes go through the existing routes via `callRoute`, so every existing check still applies; onchain actions return wallet steps that the browser signs. Model chat (`POST /assistant`) is off unless `AI_API_KEY` is set, and the adapter for it was NOT exercised against a real provider. Chat is not stored. D04 (provider) stays open.
- Notifications: in-app only, derived on every read from escrow rows and chain events; only "which keys were read" is stored (`notification_reads`). No email or SMS.
- Evidence vault (option "app level"): per-file AES-256-GCM in `vault_objects` (key `EVIDENCE_ENCRYPTION_KEY`, or derived from `PHONE_ENCRYPTION_KEY`), downloads need a link signed for the account that expires in 300 seconds, an append-only `file_log`, and a built-in structure scan (`server/lib/scan.ts`). This is NOT antivirus and does not replace an object store or a scanner; D04 and D09 stay open. Files uploaded before the vault are encrypted the first time they are read.
- English: reference translation of the 22 docs, 7 policies and the FAQ. The Vietnamese text controls until the owner names a translation reviewer (D10). The changelog entries are Vietnamese only.
