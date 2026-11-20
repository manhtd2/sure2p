/**
 * Public, unauthenticated endpoints: /trust (verifiable onchain facts), /status (live probes)
 * and /contact (support requests). They are single-segment paths on purpose so they run in the
 * existing catch-all function and do not add to the Vercel function count.
 *
 * Nothing here is invented: every figure is read from the chain at one pinned block or from the
 * indexer, and anything that cannot be read is reported as "unknown", never as zero or healthy.
 */
import { z } from 'zod'
import { erc20Abi, type Address } from 'viem'
import { dbAll, dbGet, dbRun, nowSec } from '../db.js'
import { env } from '../env.js'
import { HttpError, rateLimit, route } from '../http.js'
import { indexerStatus, publicClient } from '../indexer/index.js'
import { randomToken } from '../lib/crypto.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'

type Cached<T> = { at: number; value: T }
let trustCache: Cached<unknown> | null = null
let statusCache: Cached<unknown> | null = null
const TTL_MS = 15_000

async function pendingFromEvents(penaltyWallet: Address | null) {
  const rows = await dbAll<{ name: string; args_json: string }>(
    `SELECT name, args_json FROM chain_events WHERE chain_id = ? AND contract = ? AND name IN ('CreditAssigned','Claimed')`,
    env.chainId,
    env.escrow,
  )
  let credited = 0n
  let claimed = 0n
  let penaltyCredited = 0n
  let penaltyClaimed = 0n
  for (const r of rows) {
    const a = JSON.parse(r.args_json) as { account?: string; amount?: string }
    const amount = BigInt(a.amount ?? '0')
    const isPenalty = penaltyWallet !== null && a.account?.toLowerCase() === penaltyWallet.toLowerCase()
    if (r.name === 'CreditAssigned') {
      credited += amount
      if (isPenalty) penaltyCredited += amount
    } else {
      claimed += amount
      if (isPenalty) penaltyClaimed += amount
    }
  }
  return {
    credited: credited.toString(),
    claimed: claimed.toString(),
    pending: (credited - claimed).toString(),
    penaltyPending: (penaltyCredited - penaltyClaimed).toString(),
  }
}

async function buildTrust() {
  const indexer = indexerStatus()
  const base = {
    network: { chainId: env.chainId, usdc: env.usdc, explorerBase: env.explorerBase, usdcDecimals: 6 },
    contracts: { escrow: env.escrow, registry: env.registry, deployTx: env.deployTx ?? null, startBlock: indexer.startBlock },
    indexer: {
      cursor: indexer.cursor,
      head: indexer.head,
      blocksBehind: indexer.behind,
      lastError: indexer.lastError,
      reconciliation: indexer.reconciliation,
    },
  }
  try {
    const blockNumber = await publicClient.getBlockNumber()
    const at = { blockNumber } as const
    const read = <T>(address: Address, abi: readonly unknown[], functionName: string) =>
      publicClient.readContract({ address, abi, functionName, ...at } as never) as Promise<T>
    const [block, balance, outstanding, count, owner, arbiter, reviewer, penaltyWallet, registryCode] = await Promise.all([
      publicClient.getBlock({ blockNumber }),
      publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [env.escrow], ...at }),
      read<bigint>(env.escrow, escrowAbi, 'totalOutstanding'),
      read<bigint>(env.escrow, escrowAbi, 'escrowCount'),
      read<Address>(env.escrow, escrowAbi, 'owner'),
      read<Address>(env.escrow, escrowAbi, 'arbiter'),
      read<Address>(env.escrow, escrowAbi, 'appealReviewer'),
      read<Address>(env.escrow, escrowAbi, 'penaltyWallet'),
      publicClient.getCode({ address: env.registry, ...at }),
    ])
    const events = await pendingFromEvents(penaltyWallet)
    const covered = balance >= outstanding
    return {
      ...base,
      snapshot: { ok: true as const, blockNumber: blockNumber.toString(), blockTimestamp: Number(block.timestamp), source: 'rpc', readAt: Date.now() },
      reserves: {
        usdcHeld: balance.toString(),
        obligations: outstanding.toString(),
        surplus: covered ? (balance - outstanding).toString() : '0',
        shortfall: covered ? '0' : (outstanding - balance).toString(),
        status: covered ? ('covered' as const) : ('shortfall' as const),
      },
      claims: { ...events, source: 'indexer', indexedThroughBlock: indexer.cursor },
      escrowCount: count.toString(),
      roles: {
        owner,
        arbiter,
        appealReviewer: reviewer,
        penaltyWallet,
        penaltyEqualsOwner: owner.toLowerCase() === penaltyWallet.toLowerCase(),
      },
      registry: { deployed: Boolean(registryCode && registryCode !== '0x') },
    }
  } catch (e) {
    // Unknown, never a fake zero and never "covered".
    return {
      ...base,
      snapshot: { ok: false as const, error: e instanceof Error ? e.message.slice(0, 200) : 'read failed', readAt: Date.now() },
      reserves: { status: 'unknown' as const },
    }
  }
}

async function probe<T>(fn: () => Promise<T>): Promise<{ state: 'ok' | 'down'; ms: number; detail?: string }> {
  const t0 = Date.now()
  try {
    await fn()
    return { state: 'ok', ms: Date.now() - t0 }
  } catch (e) {
    return { state: 'down', ms: Date.now() - t0, detail: e instanceof Error ? e.message.slice(0, 120) : 'failed' }
  }
}

async function buildStatus() {
  const checkedAt = Date.now()
  const idx = indexerStatus()
  const [rpc, database] = await Promise.all([
    probe(() => publicClient.getBlockNumber()),
    probe(() => dbGet('SELECT 1 AS one')),
  ])
  const indexerState =
    idx.cursor === null || idx.cursor === undefined
      ? 'unknown'
      : idx.lastError
        ? 'degraded'
        : idx.behind !== null && idx.behind > 50
          ? 'degraded'
          : 'ok'
  return {
    checkedAt,
    components: [
      { id: 'web', state: 'ok', note: 'served this response' },
      { id: 'api', state: 'ok', note: 'served this response' },
      { id: 'rpc', ...rpc },
      { id: 'database', ...database },
      { id: 'indexer', state: indexerState, blocksBehind: idx.behind, lastError: idx.lastError },
      { id: 'otp', state: 'mock', note: 'labelled test provider; real SMS provider not chosen (D04)' },
      { id: 'evidence', ...database, note: 'evidence bytes live in the database (D04, D09 open)' },
    ],
    monitoring: 'not_configured',
  }
}

route('GET', '/trust', async () => {
  if (trustCache && Date.now() - trustCache.at < TTL_MS) return trustCache.value
  const value = await buildTrust()
  trustCache = { at: Date.now(), value }
  return value
})

route('GET', '/status', async () => {
  if (statusCache && Date.now() - statusCache.at < TTL_MS) return statusCache.value
  const value = await buildStatus()
  statusCache = { at: Date.now(), value }
  return value
})

const contactSchema = z.object({
  topic: z.enum(['account', 'transaction', 'dispute', 'security', 'other']),
  message: z.string().trim().min(10).max(2000),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  publicId: z.string().trim().max(12).optional().or(z.literal('')),
  /** Honeypot: real users leave it empty. */
  website: z.string().max(200).optional(),
})

route('POST', '/contact', async (ctx) => {
  rateLimit(`contact:${ctx.ip}`, 5, 3600)
  const body = await ctx.body(contactSchema, 8192)
  if (body.website) return { ok: true } // silently drop bots
  if (/\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b/i.test(body.message) && /seed|recovery|mnemonic|khôi phục/i.test(body.message)) {
    throw new HttpError(400, 'secrets_not_accepted', 'Do not send recovery phrases or private keys.')
  }
  await dbRun(
    'INSERT INTO support_requests (id, topic, message, email, public_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    randomToken(12),
    body.topic,
    body.message,
    body.email || null,
    body.publicId || null,
    nowSec(),
  )
  return { ok: true }
})
