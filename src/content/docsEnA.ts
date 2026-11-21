import type { DocEn } from './docTypes'

/** English reference translation of DOC01 to DOC09. The Vietnamese text is the controlling version. */
export const docsEnA: Record<string, DocEn> = {
  DOC01: {
    title: 'What sure2p is',
    summary: 'sure2p holds escrow for a deal between a buyer and a seller on the Arc test network, in USDC.',
    blocks: [
      { p: 'sure2p is an escrow app for two-party deals. The buyer locks the price plus a 25% deposit; the seller locks their own 25% deposit. When both sides confirm, the seller receives the full price and both get their deposits back.' },
      { p: 'Goods or services are exchanged entirely outside the app (email, a messaging app, a website). sure2p does not transmit, store, unlock or verify the goods. What you upload to the app is only supporting evidence for a dispute.' },
      { h: 'Terms' },
      { ul: [
        'Price: the USDC the buyer pays for the goods.',
        'Deposit: 25% of the price, rounded up; each side locks its own.',
        'Locked: money sits in the contract and belongs to nobody yet.',
        'Claimable: money has been credited to a wallet and that wallet must claim it itself.',
        'Received: money is in the wallet after a successful claim transaction.',
      ] },
      { warn: 'This version runs only on the Arc test network. Test USDC has no real value and there is no independent audit yet.' },
    ],
  },
  DOC02: {
    title: 'Quick start: eight steps',
    summary: 'From sign-in to receiving your money in eight steps.',
    blocks: [
      { steps: [
        'Sign in with a phone number and a one-time code, then link a wallet on the right network with one signature.',
        'One side creates a draft and sends an invitation (link, code or QR, valid for 24 hours).',
        'The other side claims the invitation and accepts or proposes changes. Each change creates a new version.',
        'Both wallets sign the same agreement version, then one side creates the escrow onchain.',
        'The buyer funds price plus deposit, the seller funds their deposit. The deal only becomes active when both are in.',
        'The seller delivers outside the app and declares handover.',
        'The buyer confirms receipt and accepts that the goods match the agreement.',
        'The seller receives the full price and deposit, the buyer gets their deposit back. Each wallet claims its own part.',
      ] },
      { link: 'See the example with your own amount', to: '/how-it-works' },
    ],
  },
  DOC03: {
    title: 'The Arc test network',
    summary: 'Network settings, test USDC and network fees.',
    blocks: [
      { ul: [
        'Network: Arc Testnet, chain ID 5042002.',
        'RPC: https://rpc.testnet.arc.io',
        'Block explorer: https://explorer.testnet.arc.io',
        'USDC: 0x3600000000000000000000000000000000000000, 6 decimals when used as a token.',
      ] },
      { p: 'On Arc, USDC is also the network fee currency. Fees use 18 decimals of the same USDC, so your balance is one number. Do not add a "native balance" and a "token balance" together as two amounts.' },
      { p: 'Get test USDC from the Circle faucet (faucet.circle.com). When the wallet asks to switch network, choose Arc Testnet.' },
      { warn: 'If your wallet is on another network the app blocks every action and asks you to switch.' },
    ],
  },
  DOC04: {
    title: 'Account and wallet',
    summary: 'Phone, one-time code, wallet proof and losing a key.',
    blocks: [
      { p: 'One phone number has one account. Sign-in has three layers: phone number, one-time code, then a signature proving you own the wallet on the right network. Connecting a wallet alone is not a sign-in.' },
      { p: 'The payout wallet is fixed in the signed agreement. There is no way to change the payout wallet of a signed deal, and a one-time code is not a way to recover a wallet.' },
      { warn: 'This test version uses a clearly labelled mock one-time code. It is not real phone verification.' },
      { warn: 'If you lose your wallet key, sure2p cannot recover it or change the payout wallet. Never send a recovery phrase or private key to anyone, including sure2p.' },
      { pending: 'D11', text: 'Future account recovery design is not decided yet.' },
    ],
  },
  DOC05: {
    title: 'Create a deal',
    summary: 'Draft fields, roles and acceptance criteria.',
    blocks: [
      { p: 'You choose your own role (buyer or seller). The creator is not automatically the buyer or the seller. A draft lives only on the server: nothing is onchain and no signature is asked for.' },
      { ul: [
        'Title, description and quantity.',
        'Acceptance criteria: what counts as a delivery that meets the requirements. This is the basis in a dispute.',
        'Price in USDC: greater than 0, at most 6 decimals. The app shows the rounded deposit before you sign.',
        'Handover deadline: must fall after the 24 hour funding window.',
        'Buyer response window and inspection window, 72 hours by default.',
        'The buyer may attach description files (Excel, Word, PDF, text, CSV, images). The files are locked by signature once both sides agree.',
      ] },
      { warn: 'Do not put passwords, private keys or recovery phrases in the description.' },
    ],
  },
  DOC06: {
    title: 'Invitations and negotiation',
    summary: 'Link, code, QR, 24 hour expiry and agreement versions.',
    blocks: [
      { p: 'The link, short code and QR are the same invitation. It expires after 24 hours, only one account can claim it, and you can revoke it before anyone claims. The secret part of the link sits after the # so it never passes through a server or a log.' },
      { p: 'The recipient sees the whole agreement and the deposit duties, then accepts, proposes changes or declines. Each change creates a new immutable version and voids every earlier acceptance.' },
      { warn: 'An invitation is not agreement. Only both wallets signing the same version counts.' },
    ],
  },
  DOC07: {
    title: 'Signing the agreement',
    summary: 'Typed signature, agreement hash and policy version.',
    blocks: [
      { p: 'Both wallets sign the same typed agreement (EIP-712). The signature is bound to the chain ID, contract address, a one-time nonce, the agreement hash and the policy hash. It cannot be reused for another agreement.' },
      { p: 'The agreement hash covers the terms and the hashes of the attached description files, so changing one word or one file after signing voids the signatures.' },
      { p: 'Before signing you must read and confirm the risk text. The checkbox only records consent; it is not the signature.' },
      { link: 'Read the risk disclosure', to: '/risk-disclosure' },
    ],
  },
  DOC08: {
    title: 'How 150% escrow works',
    summary: 'Price, two 25% deposits rounded up, 150% held in total.',
    blocks: [
      { code: 'deposit per side = ceil(price / 4)\nbuyer funds = price + deposit\nseller funds = deposit\ntotal held = price + 2 x deposit' },
      { ul: ['Price 100 USDC: buyer 125, seller 25, total 150.', 'Price 200 USDC: buyer 250, seller 50, total 300.'] },
      { p: 'All maths uses integers in the smallest USDC unit, never floating point. With a very small price, rounding up makes the real deposit slightly above 25%; the app shows the rounded figure before both sides sign.' },
      { p: 'The progress shown only reflects time between activation and the handover deadline. It is not money paid out gradually: before completion the seller can withdraw 0.' },
    ],
  },
  DOC09: {
    title: 'Funding',
    summary: 'Allowance, funding, the 24 hour deadline and no-penalty refunds.',
    blocks: [
      { p: 'Each side funds from its own wallet with the exact amount: the buyer funds price plus deposit, the seller funds the deposit. You first allow the contract to move exactly that much USDC, then fund. Double funding, a wrong amount or funding after the deadline is rejected.' },
      { p: 'The deal only becomes active when both sides are in onchain. The funding deadline is 24 hours from when the escrow was created onchain, not from when the draft was saved.' },
      { p: 'If it is not fully funded after 24 hours, anyone can call expire. Each funded amount becomes claimable by its original wallet with no penalty. That wallet claims it back itself, even if the account was restricted from opening new deals.' },
    ],
  },
}
