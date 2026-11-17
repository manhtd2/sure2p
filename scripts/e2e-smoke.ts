/**
 * End-to-end smoke test against the running API and Arc Testnet, using two throwaway wallets.
 *   bun run scripts/e2e-smoke.ts init    -> creates two wallets, prints their addresses only
 *   bun run scripts/e2e-smoke.ts run     -> drives the full flow with real transactions
 * Keys live in /tmp only and are never printed. Fund both addresses with testnet USDC first.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, keccak256, toBytes, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { escrowAbi } from '../src/shared/escrowAbi'
import {
  agreementFromJson,
  agreementTypes,
  eip712Domain,
  settlementFromJson,
  settlementTypes,
  type AgreementJson,
  type SettlementJson,
} from '../src/shared/protocol'

const API = process.env.E2E_API ?? 'http://localhost:8787'
const KEYS = '/tmp/sure2p-e2e-keys.json'
const ESCROW = getAddress(process.env.VITE_SURE2P_ESCROW_ADDRESS ?? '')
const USDC = getAddress('0x3600000000000000000000000000000000000000')
const CHAIN_ID = arcTestnet.id

const rpcUrl = (() => {
  const proxy = process.env.RPC_PROXY_BASE_URL
  const chains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
  if (proxy && chains.includes('Arc_Testnet')) return `${proxy}/api/rpc/Arc_Testnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
  return arcTestnet.rpcUrls.default.http[0]
})()
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })

const results: Array<{ step: string; ok: boolean; detail?: string }> = []
function record(step: string, ok: boolean, detail?: string) {
  results.push({ step, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}`)
  if (!ok) throw new Error(`step failed: ${step}`)
}

class Session {
  cookie = ''
  constructor(
    public name: string,
    public account: PrivateKeyAccount,
    public phone: string,
  ) {}

  async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, expectStatus = 200): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', Cookie: this.cookie },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
    const setCookies = res.headers.getSetCookie()
    for (const c of setCookies) {
      const pair = c.split(';')[0]
      if (pair.endsWith('=')) this.cookie = ''
      else this.cookie = pair
    }
    const json = (await res.json()) as T
    if (res.status !== expectStatus) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`)
    return json
  }

  async login() {
    const otp = await this.call<{ mockCode: string }>('POST', '/auth/otp/request', { phone: this.phone })
    await this.call('POST', '/auth/otp/verify', { phone: this.phone, code: otp.mockCode })
    const { message } = await this.call<{ message: string }>('POST', '/auth/wallet/challenge', { address: this.account.address })
    const signature = await this.account.signMessage({ message })
    await this.call('POST', '/auth/wallet/verify', { message, signature })
  }
}

// The sandbox RPC proxy is read-only for raw transactions, so writes go to the public Arc Testnet RPC.
const wallet = (account: PrivateKeyAccount) => createWalletClient({ account, chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0]) })

async function send(account: PrivateKeyAccount, label: string, run: () => Promise<Hex>): Promise<Hex> {
  const hash = await run()
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  record(label, receipt.status === 'success', hash)
  void account
  return hash
}

async function waitFor<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 90_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 2000))
  }
}

interface DraftView {
  publicId: string | null
  versions: Array<{ id: string; agreement: AgreementJson | null; buyerSig: string | null; sellerSig: string | null }>
}

async function negotiateAndCreate(seller: Session, buyer: Session, priceUnits: bigint, title: string) {
  const handoverDeadline = Math.floor(Date.now() / 1000) + 3 * 86400
  const terms = {
    title,
    description: 'E2E smoke test digital goods delivered by email.',
    quantity: '1',
    acceptanceCriteria: 'Files open and match the description.',
    deliveryChannel: 'Email',
    priceUnits: priceUnits.toString(),
    handoverDeadline,
    buyerResponseSeconds: 72 * 3600,
    inspectionSeconds: 72 * 3600,
  }
  const { id: draftId } = await seller.call<{ id: string }>('POST', '/drafts', { role: 'seller', terms })
  const inv = await seller.call<{ token: string; code: string }>('POST', `/drafts/${draftId}/invitations`, {})
  const peek = await buyer.call<{ title: string }>('POST', '/invitations/peek', { token: inv.token })
  record('invite peek via token', peek.title === title)
  const peekCode = await buyer.call<{ title: string }>('POST', '/invitations/peek', { code: inv.code })
  record('invite peek via code resolves the same invitation', peekCode.title === title)
  await buyer.call('POST', '/invitations/claim', { token: inv.token })
  await buyer.call('POST', '/invitations/claim', { code: inv.code }, 404)
  record('second claim of the same invitation is rejected (404)', true)

  // Buyer counters with a different handover deadline: a new immutable version.
  await buyer.call('POST', `/drafts/${draftId}?action=counteroffer`, { terms: { ...terms, handoverDeadline: handoverDeadline + 3600 } })
  const draft = await seller.call<DraftView>('GET', `/drafts/${draftId}`)
  record('counteroffer produced version 2', draft.versions.length === 2)
  const latest = draft.versions[1]
  const agreement = agreementFromJson(latest.agreement as AgreementJson)

  for (const s of [seller, buyer]) {
    const signature = await s.account.signTypedData({
      domain: eip712Domain(CHAIN_ID, ESCROW),
      types: agreementTypes,
      primaryType: 'Agreement',
      message: agreement,
    })
    await s.call('POST', `/drafts/${draftId}?action=sign`, { versionId: latest.id, signature, acknowledgedDisclosure: true })
  }
  const signed = await seller.call<DraftView>('GET', `/drafts/${draftId}`)
  const v = signed.versions[1]
  record('both parties signed version 2', Boolean(v.buyerSig && v.sellerSig))

  const hash = await send(seller.account, 'createEscrow confirmed onchain', () =>
    wallet(seller.account).writeContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: 'createEscrow',
      args: [agreement, v.buyerSig as Hex, v.sellerSig as Hex],
    }),
  )
  await seller.call('POST', `/drafts/${draftId}?action=submitted`, { txHash: hash })
  const indexed = await waitFor('publicId', async () => {
    const d = await seller.call<DraftView>('GET', `/drafts/${draftId}`)
    return d.publicId
  })
  record('indexer assigned a 12-hex publicId', /^(?=.*[a-f])[0-9a-f]{12}$/.test(indexed), indexed)
  const view = await seller.call<{ onChainId: string }>('GET', `/transactions/${indexed}`)
  return { publicId: indexed, id: BigInt(view.onChainId), agreement }
}

async function fund(
  seller: Session,
  buyer: Session,
  id: bigint,
  agreement: { price: bigint; buyerDeposit: bigint; sellerDeposit: bigint },
) {
  const buyerNeed = agreement.price + agreement.buyerDeposit
  await send(buyer.account, 'buyer approves the exact amount', () => wallet(buyer.account).writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [ESCROW, buyerNeed] }))
  await send(buyer.account, 'fundBuyer (price + 25% deposit)', () => wallet(buyer.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'fundBuyer', args: [id] }))
  await send(seller.account, 'seller approves the exact amount', () => wallet(seller.account).writeContract({ address: USDC, abi: erc20Abi, functionName: 'approve', args: [ESCROW, agreement.sellerDeposit] }))
  await send(seller.account, 'fundSeller (25% deposit)', () => wallet(seller.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'fundSeller', args: [id] }))
  // Reads can hit a node a block behind the one that served the receipt, so poll briefly.
  const state = await waitFor('escrow state Active', async () => {
    const e = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'getEscrow', args: [id] })
    return Number(e.state) === 2 ? 2 : null
  })
  record('escrow is Active only after both are funded', state === 2)
}

async function claimAll(label: string, a: PrivateKeyAccount, id: bigint) {
  const owed = await waitFor('claimable credit', async () => {
    const v = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [id, a.address] })
    return v > 0n ? v : null
  })
  const before = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a.address] })
  await send(a, `${label} claims ${owed} units`, () => wallet(a).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'claim', args: [id] }))
  const after = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [a.address] })
  // Gas is paid in the same USDC, so the wallet gains the credit minus a small fee.
  record(`${label} wallet balance rose by about the credit`, after > before && owed - (after - before) < 100_000n, `credit=${owed} delta=${after - before}`)
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'init') {
    const keys = { seller: generatePrivateKey(), buyer: generatePrivateKey() }
    writeFileSync(KEYS, JSON.stringify(keys), { mode: 0o600 })
    console.log('seller', privateKeyToAccount(keys.seller).address)
    console.log('buyer ', privateKeyToAccount(keys.buyer).address)
    return
  }
  if (!existsSync(KEYS)) throw new Error('run init first')
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')) as { seller: Hex; buyer: Hex }
  const stamp = String(Date.now()).slice(-7)
  // Stable phone numbers per wallet so reruns sign in to the same accounts.
  const phoneFor = (a: PrivateKeyAccount) => `+84${(BigInt(a.address) % 900_000_000n) + 100_000_000n}`
  const sellerAccount = privateKeyToAccount(keys.seller)
  const buyerAccount = privateKeyToAccount(keys.buyer)
  const outsiderAccount = privateKeyToAccount(generatePrivateKey())
  const seller = new Session('seller', sellerAccount, phoneFor(sellerAccount))
  const buyer = new Session('buyer', buyerAccount, phoneFor(buyerAccount))
  const outsider = new Session('outsider', outsiderAccount, phoneFor(outsiderAccount))
  await Promise.all([seller.login(), buyer.login(), outsider.login()])
  record('phone OTP (mock) and wallet sign-in for 3 accounts', true)

  // ---------- Trade 1: early dual-confirmation completion ----------
  const price = 1_000_000n
  const t1 = await negotiateAndCreate(seller, buyer, price, `E2E completion ${stamp}`)
  await outsider.call('GET', `/transactions/${t1.publicId}`, undefined, 404)
  record('a stranger who knows the publicId gets 404', true)
  await fund(seller, buyer, t1.id, t1.agreement)
  const held = await waitFor('escrow balance', async () => {
    const v = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [ESCROW] })
    return v >= 1_500_000n ? v : null
  })
  record('contract holds at least 1.5 USDC for a 1 USDC price (1 + 0.25 + 0.25)', held >= 1_500_000n)

  await send(seller.account, 'seller declares handover', () => wallet(seller.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'declareHandover', args: [t1.id, keccak256(toBytes('emailed files'))] }))
  const sellerBefore = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [t1.id, seller.account.address] })
  record('seller can claim zero after declaring alone', sellerBefore === 0n)
  await send(buyer.account, 'buyer confirms acceptance (early)', () => wallet(buyer.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'confirmBuyerAcceptance', args: [t1.id] }))
  await send(seller.account, 'finalizeMutualCompletion', () => wallet(seller.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'finalizeMutualCompletion', args: [t1.id] }))
  const sellerCredit = await waitFor('seller credit', async () => {
    const v = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [t1.id, seller.account.address] })
    return v > 0n ? v : null
  })
  const buyerCredit = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [t1.id, buyer.account.address] })
  record('seller credit = full price + own deposit (1.25), buyer = deposit (0.25)', sellerCredit === 1_250_000n && buyerCredit === 250_000n)
  await claimAll('seller', seller.account, t1.id)
  await claimAll('buyer', buyer.account, t1.id)

  // ---------- Trade 2: dispute then dual-signed partial-refund settlement ----------
  const t2 = await negotiateAndCreate(seller, buyer, price, `E2E settlement ${stamp}`)
  await fund(seller, buyer, t2.id, t2.agreement)
  await send(buyer.account, 'buyer opens a dispute (funds lock)', () => wallet(buyer.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'openDispute', args: [t2.id, keccak256(toBytes('not as described'))] }))
  await waitFor('indexer sees dispute', async () => {
    const v = await seller.call<{ stage: string }>('GET', `/transactions/${t2.publicId}`)
    return v.stage === 'disputed' ? v : null
  })
  record('indexer projected the disputed stage', true)

  await seller.call('POST', `/transactions/${t2.publicId}/settlements`, { buyerPriceRefund: '100000' })
  const prop = await buyer.call<{ proposal: { id: string; settlement: SettlementJson } }>('GET', `/transactions/${t2.publicId}/settlements`)
  const proposalId = prop.proposal.id
  const message = settlementFromJson(prop.proposal.settlement)
  for (const s of [seller, buyer]) {
    const signature = await s.account.signTypedData({ domain: eip712Domain(CHAIN_ID, ESCROW), types: settlementTypes, primaryType: 'Settlement', message })
    await s.call('POST', `/transactions/${t2.publicId}/settlements/${proposalId}/sign`, { signature })
  }
  const signed = await seller.call<{ proposal: { buyerSig: Hex; sellerSig: Hex } }>('GET', `/transactions/${t2.publicId}/settlements`)
  await send(seller.account, 'executeMutualSettlement (0.1 refund)', () => wallet(seller.account).writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'executeMutualSettlement', args: [t2.id, message, signed.proposal.buyerSig, signed.proposal.sellerSig] }))
  const sCredit = await waitFor('seller credit', async () => {
    const v = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [t2.id, seller.account.address] })
    return v > 0n ? v : null
  })
  const bCredit = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'claimable', args: [t2.id, buyer.account.address] })
  record('settlement: buyer 0.1 + 0.25 deposit, seller 0.9 + 0.25 deposit', bCredit === 350_000n && sCredit === 1_150_000n)
  await claimAll('seller', seller.account, t2.id)
  await claimAll('buyer', buyer.account, t2.id)

  const health = await fetch(`${API}/health`).then((r) => r.json() as Promise<{ indexer: { reconciliation: { ok: boolean } } }>)
  record('balance reconciliation ok after both trades', health.indexer.reconciliation.ok)
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`)
}

main().catch((err) => {
  console.error('E2E FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
