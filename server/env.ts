/**
 * Server configuration.
 *
 * Local dev (Bun): `.env` is loaded by Bun automatically; secrets that are
 * not provided are generated once for local development and stored under
 * `server/data` (gitignored).
 *
 * Vercel (Node): Bun does not load `.env` and there is no writable
 * `server/data`, so production deployments must set every secret explicitly
 * in the Vercel dashboard. No secret is ever written to disk on Vercel.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress, type Address } from 'viem'
import { getChain, getUsdc } from '../src/onchain-facts.js'
import { ARC_TESTNET_CHAIN_ID } from '../src/shared/protocol.js'

// `import.meta.dir` is Bun-only; this works under both Bun and Node.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = resolve(ROOT, 'server/data')

const isVercel = process.env.VERCEL === '1'

function devSecrets(): { sessionSecret: string; phoneKey: string } {
  const file = resolve(DATA_DIR, 'dev-secrets.json')
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  mkdirSync(dirname(file), { recursive: true })
  const secrets = { sessionSecret: randomBytes(32).toString('hex'), phoneKey: randomBytes(32).toString('hex') }
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 })
  return secrets
}

function requiredAddress(name: string): Address {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Deploy the contracts and add it to .env.`)
  return getAddress(value)
}

const nodeEnv = process.env.NODE_ENV ?? 'development'
const otpProvider = process.env.OTP_PROVIDER ?? 'mock'

/**
 * Demo-only opt-in for the mock OTP provider in production.
 *
 * Default behaviour is unchanged: mock OTP is refused in production.
 * Set DEMO_ALLOW_MOCK_OTP=true ONLY for a clearly labelled demo deploy —
 * anyone who can guess a phone number can sign in, because the code is
 * returned by the API. Never enable it on a deploy meant for real users.
 */
const demoMockOtp = process.env.DEMO_ALLOW_MOCK_OTP === 'true'
if (nodeEnv === 'production' && otpProvider === 'mock' && !demoMockOtp) {
  throw new Error(
    'OTP_PROVIDER=mock is for local development and testnet only. Refusing to start in production. ' +
      'For a labelled demo deploy only, set DEMO_ALLOW_MOCK_OTP=true (demo-only, never for real users).',
  )
}
if (demoMockOtp && nodeEnv === 'production') {
  console.warn(
    '[sure2p] WARNING: DEMO_ALLOW_MOCK_OTP=true — mock OTP is enabled in production. Demo only: codes are returned by the API.',
  )
}
if (otpProvider !== 'mock') {
  throw new Error(`OTP_PROVIDER=${otpProvider} is not implemented. Only the labeled mock provider exists in this build.`)
}

const dev = nodeEnv === 'production' || isVercel ? null : devSecrets()
const sessionSecret = process.env.SESSION_SECRET ?? dev?.sessionSecret
const phoneKeyHex = process.env.PHONE_ENCRYPTION_KEY ?? dev?.phoneKey
if (!sessionSecret || !phoneKeyHex) throw new Error('SESSION_SECRET and PHONE_ENCRYPTION_KEY are required in production.')
if (!/^[0-9a-fA-F]{64}$/.test(phoneKeyHex)) throw new Error('PHONE_ENCRYPTION_KEY must be 32 bytes of hex.')

const chain = getChain(ARC_TESTNET_CHAIN_ID)
const usdc = getUsdc(ARC_TESTNET_CHAIN_ID)
if (!chain || !usdc) throw new Error('Arc Testnet is missing from the onchain facts registry.')
const publicRpcUrl = chain.rpcUrls[0]
const explorerBase = chain.explorerBase
const usdcAddress = usdc.address

/** RPC endpoint: explicit override, then the sandbox RPC proxy, then the public RPC from the facts registry. */
function resolveRpcUrl(): { url: string; proxied: boolean } {
  const chainKey = 'Arc_Testnet'
  const override = process.env[`RPC_URL_${chainKey}`]
  if (override) return { url: override, proxied: false }
  const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
  if (process.env.RPC_PROXY_BASE_URL && proxyChains.includes(chainKey)) {
    return {
      url: `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${chainKey}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`,
      proxied: true,
    }
  }
  return { url: publicRpcUrl, proxied: false }
}

export const env = {
  nodeEnv,
  isVercel,
  port: Number(process.env.API_PORT ?? 8787),
  dbPath: process.env.DATABASE_PATH ?? resolve(DATA_DIR, 'sure2p.sqlite'),
  /** Turso libSQL URL (e.g. libsql://<db>-<org>.turso.io). When set, this is the database; DATABASE_PATH is ignored. */
  tursoUrl: process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? undefined,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN ?? undefined,
  dataDir: DATA_DIR,
  otpProvider: 'mock' as const,
  /** True only when DEMO_ALLOW_MOCK_OTP=true explicitly opts the demo deploy into mock OTP. */
  demoMockOtp,
  sessionSecret,
  phoneKey: Buffer.from(phoneKeyHex, 'hex'),
  extraOrigins: (process.env.APP_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  chainId: ARC_TESTNET_CHAIN_ID,
  usdc: getAddress(usdcAddress),
  explorerBase,
  rpc: resolveRpcUrl(),
  confirmations: Number(process.env.INDEXER_CONFIRMATIONS ?? 1),
  /** Max 10000-block chunks one lazy/cron indexer pass may sync. Bounds serverless work per invocation. */
  indexerSyncMaxChunks: Number(process.env.INDEXER_SYNC_MAX_CHUNKS ?? 10),
  /** Minimum gap between lazy (request-triggered) indexer passes, in ms. */
  indexerLazyMinIntervalMs: Number(process.env.INDEXER_LAZY_MIN_INTERVAL_MS ?? 15_000),
  /** Max time an API request waits for a lazy indexer pass before serving the last indexed state, in ms. */
  indexerLazyTimeoutMs: Number(process.env.INDEXER_LAZY_TIMEOUT_MS ?? 8_000),
  /**
   * Max chunks a lazy (request-triggered) pass may sync. Kept small (3)
   * so the pass normally finishes inside indexerLazyTimeoutMs: a lazy
   * pass that outlives the response risks being frozen mid-transaction
   * when Vercel suspends the container, which corrupts the libSQL
   * transaction stream ("interactive transaction was rolled back because
   * the stream was closed", seen 2026-11-16). The cron endpoint has a
   * 60s budget and keeps using indexerSyncMaxChunks.
   */
  indexerLazyMaxChunks: Number(process.env.INDEXER_LAZY_MAX_CHUNKS ?? 3),
  /** Optional shared secret for the /api/cron/indexer endpoint. When set, the cron caller must send it as a Bearer token. */
  cronSecret: process.env.CRON_SECRET ?? undefined,
  escrow: requiredAddress('VITE_SURE2P_ESCROW_ADDRESS'),
  registry: requiredAddress('VITE_ACCOUNT_REGISTRY_ADDRESS'),
  deployTx: process.env.VITE_SURE2P_ESCROW_DEPLOY_TX as `0x${string}` | undefined,
}

export type Env = typeof env
