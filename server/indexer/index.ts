/**
 * Durable event indexer for Sure2PEscrow.
 *  - starts from the contract's deployment block, never from block 0
 *  - bounded getLogs ranges, durable cursor, (chainId, txHash, logIndex) idempotency
 *  - reorg detection by comparing the stored cursor block hash, with reset + replay
 *  - balance reconciliation: USDC held by the escrow must cover outstanding liabilities
 *
 * Serverless note (Vercel): there is no always-on loop. Indexing happens
 * on demand — a bounded, debounced pass triggered lazily by API reads
 * (`maybeSyncIndexer`, see server/http.ts) and by the Vercel Cron endpoint
 * (`api/cron/indexer.ts`, which calls `runIndexerOnce`). The durable cursor,
 * idempotency and reorg handling are unchanged; only the trigger changed.
 * Local dev still runs the continuous loop via `startIndexer()`.
 */
import { createPublicClient, erc20Abi, http, type PublicClient } from 'viem'
import { arcTestnet } from 'viem/chains'
import { dbRun, dbTx, getState, setState } from '../db.js'
import { env } from '../env.js'
import { applyEvent, rebuildProjections } from './project.js'
import { escrowAbi } from '../../src/shared/escrowAbi.js'

const CHUNK = 10000
const REORG_REWIND = 25
const POLL_MS = 3000
const RECONCILE_EVERY_MS = 30_000
/** How long a lazy/cron indexer lock is held before another invocation may take over. */
const INDEXER_LOCK_TTL_MS = 120_000

export const publicClient: PublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(env.rpc.url),
})

interface Status {
  cursor: number | null
  head: number | null
  behind: number | null
  startBlock: number | null
  running: boolean
  lastRunAt: number | null
  lastError: string | null
  reconciliation: null | {
    at: number
    contractBalance: string
    totalOutstanding: string
    ok: boolean
  }
}

const status: Status = {
  cursor: null,
  head: null,
  behind: null,
  startBlock: null,
  running: false,
  lastRunAt: null,
  lastError: null,
  reconciliation: null,
}

export function indexerStatus(): Status {
  return { ...status }
}

/** True while the local continuous background loop is running (never on Vercel). */
export function isBackgroundIndexerRunning(): boolean {
  return status.running
}

function serializeArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'bigint' ? v.toString() : String(v)
  return out
}

async function resolveStartBlock(): Promise<number> {
  const saved = await getState('start_block')
  if (saved) return Number(saved)
  let start: number | null = null
  if (env.deployTx) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: env.deployTx })
      start = Number(receipt.blockNumber)
    } catch {
      start = null
    }
  }
  if (start === null) {
    // Deployment block unknown: only a recent-window scan is honest, so say so.
    const head = Number(await publicClient.getBlockNumber())
    start = Math.max(0, head - 5000)
    console.warn(`[indexer] deployment block not resolved, scanning only the last 5000 blocks from ${start}`)
  }
  await setState('start_block', String(start))
  return start
}

async function detectReorg(cursor: number): Promise<number> {
  const storedHash = await getState('cursor_hash')
  if (!storedHash) return cursor
  const block = await publicClient.getBlock({ blockNumber: BigInt(cursor) })
  if (block.hash === storedHash) return cursor
  const rewindTo = Math.max(0, cursor - REORG_REWIND)
  console.warn(`[indexer] reorg detected at ${cursor}, rewinding to ${rewindTo}`)
  await dbTx(async () => {
    await dbRun('DELETE FROM chain_events WHERE block_number > ?', rewindTo)
    await rebuildProjections()
  })
  const anchor = await publicClient.getBlock({ blockNumber: BigInt(rewindTo) })
  await setState('cursor', String(rewindTo))
  await setState('cursor_hash', anchor.hash)
  return rewindTo
}

async function indexRange(from: number, to: number): Promise<void> {
  // The Arc testnet RPCs cap topics-filtered eth_getLogs by both range
  // and topic count: one call with all 15 escrow events fails with
  // -32012 "requested range too large" even over 10 blocks, and 3 topics
  // fail over 50000 blocks — while 5 topics work over 10000 blocks and
  // 1-3 topics work over 1000 blocks (verified 2026-11-16). So the events
  // are queried in groups of 5, each call carrying a subset ABI so viem
  // builds a 5-topic filter and decodes only those events; the groups
  // run sequentially to stay under the public gateway's rate limit
  // (parallel per-event calls tripped "Request exceeds defined limit").
  // Results are merged back into chain order below.
  const events = escrowAbi.filter(
    (e): e is Extract<typeof escrowAbi[number], { type: 'event' }> => e.type === 'event',
  )
  const perGroup: Awaited<ReturnType<typeof publicClient.getContractEvents>>[] = []
  for (let i = 0; i < events.length; i += 5) {
    const group = events.slice(i, i + 5)
    const groupAbi = escrowAbi.filter(
      (e) => e.type !== 'event' || group.some((g) => g.name === (e as { name?: string }).name),
    )
    perGroup.push(
      await publicClient.getContractEvents({
        address: env.escrow,
        abi: groupAbi,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      }),
    )
  }
  const logs = perGroup
    .flat()
    .sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)) || Number((a.logIndex ?? 0) - (b.logIndex ?? 0)))
  const timestamps = new Map<bigint, number>()
  const hashes = new Map<bigint, string>()
  for (const log of logs) {
    if (log.blockNumber === null || timestamps.has(log.blockNumber)) continue
    const block = await publicClient.getBlock({ blockNumber: log.blockNumber })
    timestamps.set(log.blockNumber, Number(block.timestamp))
    hashes.set(log.blockNumber, block.hash)
  }
  const tipHash = (await publicClient.getBlock({ blockNumber: BigInt(to) })).hash

  await dbTx(async () => {
    for (const log of logs) {
      if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null || !('eventName' in log)) continue
      const args = serializeArgs((log.args ?? {}) as Record<string, unknown>)
      const inserted = await dbRun(
        `INSERT OR IGNORE INTO chain_events
         (chain_id, tx_hash, log_index, block_number, block_hash, block_timestamp, contract, name, on_chain_id, args_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        env.chainId,
        log.transactionHash,
        log.logIndex,
        Number(log.blockNumber),
        hashes.get(log.blockNumber) ?? '',
        timestamps.get(log.blockNumber) ?? 0,
        env.escrow,
        String(log.eventName),
        args.escrowId ?? null,
        JSON.stringify(args),
      )
      // Already-seen logs are skipped, so a replayed range never double-applies.
      if (inserted.changes === 1) {
        await applyEvent({
          name: String(log.eventName),
          blockNumber: Number(log.blockNumber),
          blockTimestamp: timestamps.get(log.blockNumber) ?? 0,
          txHash: log.transactionHash,
          args,
        })
      }
    }
    await setState('cursor', String(to))
    await setState('cursor_hash', tipHash)
  })
}

export async function reconcile(): Promise<void> {
  const [balance, outstanding] = await Promise.all([
    publicClient.readContract({ address: env.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [env.escrow] }),
    publicClient.readContract({ address: env.escrow, abi: escrowAbi, functionName: 'totalOutstanding' }),
  ])
  status.reconciliation = {
    at: Date.now(),
    contractBalance: balance.toString(),
    totalOutstanding: outstanding.toString(),
    ok: balance >= outstanding,
  }
  if (!status.reconciliation.ok) console.error('[indexer] RECONCILIATION FAILED: balance below outstanding liabilities')
}

/**
 * One bounded sync pass. `maxChunks` caps the 10000-block ranges this call
 * may index (default: env.indexerSyncMaxChunks) so a single serverless
 * invocation never runs unbounded; the next lazy pass or cron run continues
 * from the durable cursor. 10000 blocks is the largest range the Arc
 * testnet RPCs accept for a 5-topic eth_getLogs (a 15-topic filter fails
 * even over 10 blocks, and 3 topics fail over 50000 blocks — see
 * indexRange, verified 2026-11-16).
 */
async function tickOnce(maxChunks: number): Promise<void> {
  const startBlock = await resolveStartBlock()
  status.startBlock = startBlock
  const savedCursor = await getState('cursor')
  let cursor = Number(savedCursor ?? startBlock - 1)
  if (savedCursor !== undefined) cursor = await detectReorg(cursor)
  const head = Number(await publicClient.getBlockNumber())
  const safeHead = head - env.confirmations
  status.head = head
  let chunks = 0
  while (cursor < safeHead && chunks < maxChunks) {
    const from = cursor + 1
    const to = Math.min(safeHead, from + CHUNK - 1)
    await indexRange(from, to)
    cursor = to
    status.cursor = cursor
    status.behind = Math.max(0, head - cursor)
    chunks += 1
  }
  status.cursor = cursor
  status.behind = Math.max(0, head - cursor)
  status.lastRunAt = Date.now()
  status.lastError = null
}

/**
 * Durable lock so concurrent serverless invocations do not duplicate indexing
 * work. The lock is one row in indexer_state holding an expiry timestamp;
 * the atomic conditional upsert means only one caller wins, and a crashed
 * holder's lock expires after INDEXER_LOCK_TTL_MS. Returns the expiry token
 * on success, null when another invocation holds the lock.
 */
async function tryAcquireLock(): Promise<string | null> {
  const expiry = String(Date.now() + INDEXER_LOCK_TTL_MS)
  const res = await dbRun(
    `INSERT INTO indexer_state (key, value) VALUES ('indexer_lock', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(value AS INTEGER) < ?`,
    expiry,
    Date.now(),
  )
  return res.changes === 1 ? expiry : null
}

async function releaseLock(expiry: string): Promise<void> {
  await dbRun(`DELETE FROM indexer_state WHERE key = 'indexer_lock' AND value = ?`, expiry).catch(() => undefined)
}

/**
 * Run one bounded sync pass under the durable lock. Used by the Vercel Cron
 * endpoint and by lazy request-triggered sync. Returns true when a pass ran
 * (or was already caught up), false when another invocation holds the lock.
 */
export async function runIndexerOnce(maxChunks: number = env.indexerSyncMaxChunks): Promise<boolean> {
  const lock = await tryAcquireLock()
  if (!lock) return false
  try {
    await tickOnce(maxChunks)
    return true
  } catch (err) {
    // Keep the full first lines of the error: viem puts the JSON-RPC code
    // and message (e.g. -32012 "requested range too large") after the
    // generic first line, and that detail is what diagnoses RPC failures.
    const full = err instanceof Error ? err.message : 'indexer error'
    status.lastError = full.replace(/\s+/g, ' ').slice(0, 300)
    console.error('[indexer] sync pass failed:', status.lastError)
    throw err
  } finally {
    await releaseLock(lock)
  }
}

let inFlight: Promise<boolean> | null = null
let lastLazyAttempt = 0

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Lazy, debounced indexer sync for serverless: no-op while the local
 * background loop runs, while a pass is already in flight, or within
 * INDEXER_LAZY_MIN_INTERVAL_MS of the last attempt. Never throws — callers
 * (API reads) must still serve the last indexed state if the chain is down.
 * A slow RPC must never stall an API response either: the wait is capped
 * at INDEXER_LAZY_TIMEOUT_MS (default 8s) and the request is then served
 * from the last indexed state; the pass keeps its durable lock until it
 * finishes or the function is frozen, and the next request retries.
 */
export async function maybeSyncIndexer(): Promise<boolean> {
  if (isBackgroundIndexerRunning()) return false
  // A pass already running: wait for it, but never longer than the timeout.
  if (inFlight) return Promise.race([inFlight, sleep(env.indexerLazyTimeoutMs).then(() => false)])
  if (Date.now() - lastLazyAttempt < env.indexerLazyMinIntervalMs) return false
  lastLazyAttempt = Date.now()
  // Lazy passes are capped to a few chunks so they finish inside the
  // request wait window instead of being frozen mid-transaction (see
  // env.indexerLazyMaxChunks); the cron endpoint runs the larger pass.
  inFlight = runIndexerOnce(env.indexerLazyMaxChunks).catch(() => false)
  const current = inFlight
  void current.finally(() => {
    if (inFlight === current) inFlight = null
  })
  return Promise.race([current, sleep(env.indexerLazyTimeoutMs).then(() => false)])
}

export function startIndexer(): void {
  if (status.running) return
  status.running = true
  let lastReconcile = 0
  const loop = async () => {
    try {
      // Local dev: unbounded pass, same as before.
      await tickOnce(Number.POSITIVE_INFINITY)
      if (Date.now() - lastReconcile > RECONCILE_EVERY_MS) {
        lastReconcile = Date.now()
        await reconcile()
      }
    } catch (err) {
      status.lastError = err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'indexer error'
      console.error('[indexer] tick failed:', status.lastError)
    }
    setTimeout(loop, POLL_MS)
  }
  void loop()
}
