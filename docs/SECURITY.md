# Security and trust model

## Trust disclosure

The escrow reduces payment and counterparty risk by locking funds in a contract. It does not prove that goods are genuine and it is not trustless dispute resolution. In this release a locked deal can only be released by both parties signing a settlement. Human Admin adjudication is planned and not active.

## Controls in this build

- No custody of keys. Users sign agreements, funding, confirmations, settlements and claims in their own wallet. The server never broadcasts for a user.
- Financial actions require a verified phone account and a wallet that signed a sign-in message (EIP-4361) on Arc Testnet. A connected wallet alone is not authentication.
- Every transaction endpoint checks that the session wallet is the Buyer or Seller of that exact escrow on the configured chain and contract. Missing and unauthorized items return the same 404. The public ID is not a secret.
- Invitations: 256-bit tokens and 80-bit codes stored as keyed hashes, 24 hour expiry, revocation, atomic single claim, rate limits, uniform 404 for any failure. Scanning a QR does not authenticate or consent.
- Replay protection: EIP-712 domain with chain and contract, unique agreement hash and per-buyer nonce, per-escrow settlement nonce, deadlines.
- Exact-amount approvals only, never unlimited.
- Banned wallets are blocked from new escrows at the contract. Server-side bans alone could be bypassed by calling the contract directly.
- Rate limits on OTP request, OTP verify, wallet challenge, invitation lookup, drafts and signatures. Request body size limits and typed validation.
- Responses use private, no-store caching and a no-referrer policy.

## Known limitations

- OTP is a mock in this build. A phone number does not prove a unique person.
- A lost wallet key cannot be recovered.
- A missing Admin cannot resolve disputes yet, so deadlock is possible when parties disagree.
- The registry roles belong to the platform deployer wallet and must be handed to an operator before real use.
- No independent audit. No mainnet deployment is supported or intended.
- Server rate limits are in memory and reset on restart.
