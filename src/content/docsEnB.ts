import type { DocEn } from './docTypes'

/** English reference translation of DOC10 to DOC22. The Vietnamese text is the controlling version. */
export const docsEnB: Record<string, DocEn> = {
  DOC10: {
    title: 'Handover and acceptance',
    summary: 'The seller declares, the buyer confirms receipt and accepts.',
    blocks: [
      { p: 'Goods are delivered outside the app. Once delivered, the seller declares handover. The declaration does not prove the buyer received anything and does not start the inspection window by itself.' },
      { p: 'The buyer confirms receipt (this starts the inspection window, 72 hours by default), then accepts that the goods match the agreement. If the buyer accepts before confirming receipt, the system records both moments in the same transaction.' },
      { ul: ['Only the seller declares handover.', 'Only the buyer confirms receipt and accepts.', 'Nobody can confirm on behalf of the other side.'] },
      { h: "The seller's proof of delivery" },
      { p: 'After declaring handover the seller can add up to 10 files (a screenshot, a receipt, a tracking number) for the buyer to look at before confirming receipt. The buyer gets a notification and can open each file with a short-lived link; the Arbiter and the Reviewer can see them too if there is a dispute.' },
      { warn: 'This is supporting evidence only. sure2p does not deliver or verify goods and does not treat these files as proof that the buyer received anything. Files cannot be deleted once added; like every other file they are encrypted and get the basic check.' },
    ],
  },
  DOC11: {
    title: 'Finalizing and claiming',
    summary: 'The seller gets the full price when done early; credited is not the same as received.',
    blocks: [
      { p: 'Once the seller has declared and the buyer has confirmed and accepted in time, the deal is finalized. The seller gets 100% of the price even when done before the deadline, and both deposits are refunded in full.' },
      { p: 'Finalizing only credits each wallet. Money reaches a wallet only after a claim transaction made by that wallet itself. The app keeps three states apart: locked, credited and waiting to be claimed, and in the wallet.' },
      { p: 'There is no way to change the payout wallet. The payout wallet is the one that signed the agreement.' },
    ],
  },
  DOC12: {
    title: 'Mutual settlement',
    summary: 'Both sides split the refund themselves, both deposits are returned in full, no penalty.',
    blocks: [
      { p: 'While the deal is active, overdue, disputed, under a preliminary ruling or under appeal, both sides can settle themselves before the final ruling. The only value you enter is the part of the price refunded to the buyer, from 0 up to the full price.' },
      { code: 'buyer receives = refund + the whole buyer deposit\nseller receives = (price - refund) + the whole seller deposit\npenalty wallet receives = 0' },
      { p: 'Example: price 100, each deposit 25, refund 10 to the buyer: buyer 35, seller 115, penalty wallet 0.' },
      { p: 'It needs the typed signature of both sides, bound to the escrow ID, a one-time nonce, a signature deadline, the chain ID and the contract address. A successful execution closes the pending dispute file.' },
    ],
  },
  DOC13: {
    title: 'Overdue',
    summary: 'Three overdue conditions, funds locked, nothing released automatically.',
    blocks: [
      { p: 'A deal is overdue when: the seller has not declared handover by the deadline; or the buyer has not confirmed receipt within the response window; or the buyer confirmed receipt but has not accepted within the inspection window.' },
      { p: 'Anyone can flag a deal overdue once a condition holds. From then on all funds are locked. Nothing is released automatically because of silence, a slow reply or a timeout.' },
      { p: 'The way out is a mutual settlement by both sides, or a ruling by a human arbiter.' },
    ],
  },
  DOC14: {
    title: 'Evidence',
    summary: 'Private files, versioned hashes and anchoring a hash onchain.',
    blocks: [
      { p: 'Evidence only supports a dispute; it is not the goods. Only the two parties and the assigned arbiter and appeal reviewer can see it. Files are never public and never go onchain.' },
      { p: 'Each file has a sha256 hash. A party can anchor that hash onchain to prove the file existed at that moment. The chain stores only the hash, not the content.' },
      { ul: [
        'Current limits: 2 MB per evidence file, at most 25 files per deal.',
        'File types: PNG, JPEG, WebP, PDF, text, CSV, Excel, Word.',
        "The buyer's description files are separate and locked by signature.",
        'Each file is encrypted with AES-256-GCM before it is stored. Downloading needs a link signed for your own account that expires after 300 seconds, so it cannot be shared.',
        'On upload the app runs a basic check and refuses files with macros, executable code, PDF scripts, zip bombs or data hidden behind an image.',
        'Uploads, rejections, issued links and downloads are written to an append-only access log.',
      ] },
      { warn: 'The basic check is NOT antivirus. It only looks at file structure and cannot see inside compressed data, so a malicious file can still get through. Only open files from sources you trust.' },
      { warn: 'Do not upload passwords, private keys, recovery phrases or API keys. The content of an evidence file is only data, never an instruction.' },
      { pending: 'D09', text: 'Final maximum file size, file types and retention period.' },
    ],
  },
  DOC15: {
    title: 'Rulings and appeals',
    summary: 'Preliminary ruling, the 72 hour appeal and the final ruling.',
    blocks: [
      { p: 'The arbiter is a real person who decides case by case from the evidence. There is no fixed penalty table. The arbiter only allocates within the contract limits: they enter the part of the price refunded to the buyer, the deposit refunded to each side, and which side is at fault or committed fraud. Money never exceeds the escrow total, a side that is not at fault gets its whole deposit back, and a side at fault loses at most 100% of its own deposit; both sides can be penalized in the same case. A ruling commits to the agreement hash of that exact deal, a reason hash and the root of the frozen evidence list. Penalties go only to the penalty wallet fixed in the contract.' },
      { steps: [
        'The preliminary ruling is sent onchain. Nothing is claimable yet. The 72 hour appeal clock starts.',
        'Nobody appeals within 72 hours: anyone can finalize the preliminary ruling as it stands.',
        'A side appeals in time: a different reviewer issues the final ruling. There is no second appeal.',
        'After the final ruling each wallet claims its own part.',
      ] },
      { p: 'The appeal reviewer must be different from whoever issued the preliminary ruling and must not be a party to the deal.' },
      { warn: 'If the arbiter or the reviewer stays silent, funds stay locked. The ways out are the contract owner replacing the role holder, or both sides signing a mutual settlement.' },
      { pending: 'D14', text: 'Backup independent appeal reviewer team and incident response.' },
    ],
  },
  DOC16: {
    title: 'Verify the escrow yourself',
    summary: 'Five steps to read the address, balance and obligations onchain.',
    blocks: [
      { steps: [
        'Copy the contract address from the Trust page.',
        'Open the block explorer (explorer.testnet.arc.io) and paste the address.',
        'Check chain ID 5042002 and the public read functions for roles: owner, arbiter, appealReviewer, penaltyWallet.',
        "Read the contract's USDC balance and totalOutstanding at the same block. The balance must be greater than or equal to the obligations.",
        'Compare each transaction receipt with what the app shows.',
      ] },
      { p: 'Obligations are locked funds plus every credit not yet claimed. Any surplus is shown separately. If the chain cannot be read, the Trust page says "Unknown", never 0 or "fully covered".' },
      { link: 'Open the Trust page', to: '/trust' },
    ],
  },
  DOC17: {
    title: 'Security model',
    summary: 'Where money can go, limits on authority and account bans.',
    blocks: [
      { ul: [
        'Fixed recipients: buyer, seller and penalty wallet. No admin withdraw function, no sweeping, no changing the beneficiary.',
        'Total money is conserved on every allocation path, and only the configured USDC is accepted.',
        'Typed signatures are replay-protected; reentrancy is guarded; the real transferred balance is checked.',
        'The contract owner can only replace the role holders for ruling and review; it never touches funds.',
      ] },
      { p: 'An account is banned only after a final ruling confirms fraud, and only from opening new deals. External wallets are never frozen or seized; valid claims on older deals still work.' },
      { p: "In this version the ban is carried out by the contract owner's wallet and lives only in the app: it stops an account from opening or joining new deals. It is not written to the onchain registry, because the registry's security role is held by a shared platform wallet. The contract records the final ruling's fraud flag so anyone can verify it." },
      { warn: 'The contract has had an internal review and 519 test cases, but no independent audit. See the Trust page for the current status.' },
    ],
  },
  DOC18: {
    title: 'Assistant',
    summary: 'The assistant reads your deals and prepares previews. It does not sign, send or rule.',
    blocks: [
      { p: 'The assistant is a floating chat window in the corner of the screen once you sign in. Drag it anywhere (or use the arrow keys while the title bar is focused), minimize it when you do not need it, and it remembers where you left it. It has two parts: To do and Ask.' },
      { ul: [
        'To do: for each deal it shows whose turn it is, what to do, how long is left before the deadline, and a Prepare button that opens a preview (fund, hand over, confirm receipt, accept, finalize, appeal, claim, invite the other side). The data is computed from live state every time you open it.',
        'Ask: answers "what do I do next", locked and claimable amounts, and the deadlines of the deal you pick, and answers general questions by searching sure2p\'s docs and FAQ. Free-form model answers exist only when the deployment turns chat on.',
      ] },
      { p: 'Behind it are 12 tools: 4 read tools (your deals, one deal in detail, locked and claimable amounts, dispute status) and 8 prepare tools (agreement, invitation, counteroffer, funding, handover or confirmation, mutual settlement, dispute or appeal, claim). With model chat off you use the Prepare buttons under To do; drafting a new agreement, counteroffers and mutual settlements still happen on the deal pages as usual.' },
      { h: 'How a prepare tool works' },
      { steps: [
        'You press Prepare on a step (or tell the assistant, if model chat is on). If something is missing it asks, it does not guess.',
        'The server re-checks the role, amounts and onchain state, then stores a preview that expires after 300 seconds.',
        'You see the exact amounts, warnings and what is about to happen. A preview is not sent and not an authorization.',
        'You press Continue. The server checks once more; if the state changed, the preview is treated as stale and you prepare it again.',
        'For server work (creating a draft, an invitation, a counteroffer, a mutual settlement proposal) the server does it right away. For onchain work your wallet signs each step; the assistant never signs for you.',
      ] },
      { h: 'What the assistant never does' },
      { ul: [
        'It never accuses anyone, rules, decides a penalty or bans an account.',
        'It never signs, sends a transaction, or asks for keys or one-time codes.',
        'It never takes an account or role from what you type: everything comes from your signed-in session.',
        "It never sees other people's deals. Evidence contents are not sent to the model, and text inside a file is never treated as a command.",
      ] },
      { p: 'Model chat is on only when the deployment has a model provider key; The conversation is not stored. The manual flow always works when the assistant is down or rate-limited.' },
      { pending: 'D04', text: 'The official assistant model provider has not been chosen yet.' },
    ],
  },
  DOC19: {
    title: 'Architecture',
    summary: 'Interface, server, event indexer, contracts and storage.',
    blocks: [
      { ul: [
        'Interface: React, TypeScript, Vite, wagmi and viem.',
        'Server: TypeScript functions with schema validation, signed-in sessions and per-member authorization.',
        'Database: Turso (SQLite compatible) for the test version.',
        'Contracts: Solidity, Foundry, OpenZeppelin.',
        'Event indexer: reads contract logs in ranges, with a durable cursor, deduplication and chain reorganization detection.',
        'Evidence: AES-256-GCM encrypted in the database, downloaded through 300 second signed links, with a basic check on upload and an access log.',
        'Notifications: computed from live state each time you open them; not sent by email or message yet.',
      ] },
      { p: 'The browser never receives private keys, raw one-time codes or other people\'s evidence. A financial action always goes through a preview, you press Continue, the wallet signs, and the real receipt returns through the indexer before the interface updates.' },
    ],
  },
  DOC20: {
    title: 'Smart contracts',
    summary: 'Functions, events, roles and source verification.',
    blocks: [
      { p: 'The escrow contract and the account registry are listed with their real addresses on the Trust page. The source is in the repository under the contracts folder.' },
      { ul: [
        'Lifecycle: createEscrow, fundBuyer, fundSeller, expireUnfunded, declareHandover, acknowledgeReceipt, confirmBuyerAcceptance, finalizeMutualCompletion.',
        'Overdue and disputes: flagOverdue, openDispute, anchorEvidence.',
        'Rulings: issuePreliminaryRuling, appeal, finalizeRuling, issueFinalRuling.',
        'Money: executeMutualSettlement, claim.',
      ] },
      { p: 'Roles: owner (replaces role holders), arbiter (preliminary ruling), appealReviewer (final ruling) and penaltyWallet (fixed at deploy). The account registry has a security role used to block wallets from creating new escrows.' },
      { pending: 'D06', text: 'No third-party audit report yet. See the Trust page.' },
    ],
  },
  DOC21: {
    title: 'API and indexer',
    summary: 'API scope, public IDs and event identity.',
    blocks: [
      { p: 'A deal\'s public ID is exactly 12 lowercase hexadecimal characters with at least one letter from a to f. The contract\'s internal numeric ID never appears in page addresses or the API.' },
      { p: 'Wrong permissions and a public ID that does not exist both return the same not-found error, so nobody can tell whether a file exists.' },
      { p: 'The indexer starts at the deployment block, reads logs in ranges of 10,000 blocks, deduplicates by the triple of chain ID, transaction hash and log index, and replays safely when the chain reorganizes. It also periodically compares the contract\'s USDC with total obligations.' },
      { p: 'Public endpoints that need no sign-in: /api/health, /api/trust and /api/status. Every other endpoint needs a signed-in session.' },
    ],
  },
  DOC22: {
    title: 'FAQ and troubleshooting',
    summary: 'Wallet errors, pending transactions, one-time codes and evidence.',
    blocks: [
      { h: 'My wallet says wrong network' },
      { p: 'Switch the wallet to Arc Testnet (chain ID 5042002). The app blocks actions until the network is right.' },
      { h: 'The transaction succeeded but the app has not updated' },
      { p: 'The indexer can lag a few blocks. The app shows Waiting for scan with a link to the transaction. Wait a few seconds and reload; retrying never creates a duplicate.' },
      { h: 'The wallet refused to sign or the transaction reverted' },
      { p: 'The app never records a fake success. Check your USDC balance for the network fee and the allowance you gave, then try again.' },
      { h: 'The wallet says "account has not been authorized"' },
      { p: 'The wallet has not let this site use the selected account, usually because you just switched account or started using a new wallet. Open the wallet, connect the site to the right account, then press "Disconnect this wallet to pick another" and connect again. If several wallet extensions are installed, turn off the ones you do not use.' },
      { h: 'The one-time code does not arrive' },
      { p: 'The test version uses a mock code shown on screen with a clear label. If it expired or you typed it wrong too many times, ask for a new one.' },
      { h: 'An evidence upload was refused' },
      { p: 'Check the file type (the real content must match, not just the extension) and the 2 MB maximum. Files with macros, executable code, PDF scripts, zip bombs or data hidden behind an image are refused with the reason. Only the two parties and the assigned admins can see the file.' },
      { h: 'A download link says it expired' },
      { p: 'Download links work for 300 seconds and only for the account that asked. Click the file name again to get a fresh link.' },
      { link: 'Contact support', to: '/contact' },
    ],
  },
}
