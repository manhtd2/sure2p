# Business rules

## Money

- Price is in USDC base units (6 decimals). Amounts are always integers.
- Buyer deposit and Seller deposit are each `ceil(price / 4)`.
- Buyer funds `price + buyer deposit` in one transfer. Seller funds `seller deposit` in one transfer.
- Total held: `price + 2 x deposit`. Example: price 100 gives Buyer 125, Seller 25, contract 150.
- The deal becomes active only when both are fully funded. There is no partial activation.

## Lifecycle

1. Draft (offchain). Either side creates it and chooses a role. One invitation (link, code, QR).
2. Negotiation. Accepting means signing the exact version. A counteroffer creates a new immutable version and old signatures stop applying.
3. Escrow creation onchain with both signatures. A 24 hour funding window starts at confirmed creation.
4. Funding. If someone does not fund in time, anyone can expire the escrow and every funded amount is credited back with no penalty.
5. Active. The time bar is informational. Nothing is withdrawable before dual confirmation.
6. Seller declares handover (a claim, not proof). Buyer acknowledges receipt (starts a 72 hour inspection by default) and accepts. Buyer may accept directly, which records the acknowledgement too.
7. Completion credits the Seller with the full price plus their deposit and the Buyer with their deposit. Each side claims to its own wallet.

## Overdue and disputes

Nothing is ever released automatically on silence or on a deadline. These conditions lock funds (escalation only):

1. The Seller has not declared handover by the handover deadline.
2. The Buyer has not acknowledged receipt within the response window after the Seller's declaration.
3. The Buyer acknowledged but has not accepted within the inspection window.

Anyone may flag an overdue escrow. Completion is refused when any condition holds even if no one flagged it. Either party may open one dispute until the Buyer accepts; opening it penalizes nobody.

## Release from a lock

- Mutual settlement signed by both parties. The Buyer receives a price refund between 0 and the price plus their full deposit. The Seller receives the rest of the price plus their full deposit. No penalty. Available until the deal is finalized, including during a ruling or appeal.
- Arbiter ruling (overdue or disputed deals): the Arbiter sets the Buyer's price refund (0 to the price), names the at-fault side (none, Buyer or Seller) and a penalty of at most 100% of that side's own deposit. The penalty is paid to a fixed penalty wallet. A written reason is required.
- Appeal: within 72 hours of a preliminary ruling either party may appeal once. A different Appeal Reviewer issues the final ruling, which may keep, lower or raise the penalty and change the split. With no appeal, anyone may finalize the ruling after 72 hours.
- Nothing is released automatically if the Arbiter or Appeal Reviewer stays silent. The contract owner can replace them.
- Evidence: parties upload files (PNG, JPEG, WebP, PDF, text, up to 2 MB, 25 per deal) while a deal is overdue, disputed or under ruling. Only the parties and the onchain Arbiter and Appeal Reviewer can open them. A party may anchor a file's hash onchain.

## Accounts

- One account per phone number. A banned account cannot start or join new trades, and its linked wallets are blocked from new escrows by the registry. Existing claims remain possible.
- Payout wallets are fixed by the signed agreement. There is no recovery of a lost wallet key.
