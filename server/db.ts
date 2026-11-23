/**
 * Database layer — one async API, two drivers.
 *
 * - Local dev (Bun, no TURSO_DATABASE_URL): the existing `bun:sqlite` file
 *   database under `server/data`, exactly as before.
 * - Vercel (Node, TURSO_DATABASE_URL set): Turso libSQL over HTTP. The
 *   schema is SQLite, so the same SQL, tables and business logic work
 *   unchanged — this is why Turso was chosen over Vercel Postgres/Neon,
 *   which would have needed a Postgres dialect rewrite (? -> $1,
 *   INSERT OR IGNORE -> ON CONFLICT DO NOTHING, GLOB -> regex, …).
 *
 * Every query is async (`dbGet` / `dbAll` / `dbRun`) and goes through
 * `dbTx` for multi-statement atomic blocks. Inside a `dbTx` callback the
 * helpers are routed to the open transaction via AsyncLocalStorage, so
 * nested helpers (touchDraft, applyEvent, …) stay correct without being
 * passed a tx object around. The `bun:sqlite` import is dynamic and only
 * ever loaded on the local path, so this module also loads under Node on
 * Vercel, where `bun:sqlite` does not exist.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { env } from './env.js'

export type SqlParams = Array<string | number | bigint | null | Uint8Array>

export interface RunResult {
  changes: number
  lastInsertRowid?: number | bigint
}

type Row = Record<string, unknown>

interface TxContext {
  get<T>(sql: string, params: SqlParams): Promise<T | null>
  all<T>(sql: string, params: SqlParams): Promise<T[]>
  run(sql: string, params: SqlParams): Promise<RunResult>
}

interface Driver {
  get<T>(sql: string, params: SqlParams): Promise<T | null>
  all<T>(sql: string, params: SqlParams): Promise<T[]>
  run(sql: string, params: SqlParams): Promise<RunResult>
  exec(sql: string): Promise<void>
  tx<T>(fn: () => Promise<T>): Promise<T>
}

const txStore = new AsyncLocalStorage<TxContext | null>()

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  phone_hmac TEXT NOT NULL UNIQUE,
  phone_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned','limited')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_links (
  address TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  proof_message TEXT NOT NULL,
  proof_signature TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  linked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_links_account ON wallet_links(account_id);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  wallet TEXT,
  chain_id INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  phone_hmac TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_challenges(phone_hmac, created_at);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  nonce TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  creator_account TEXT NOT NULL REFERENCES accounts(id),
  creator_role TEXT NOT NULL CHECK (creator_role IN ('buyer','seller')),
  creator_wallet TEXT NOT NULL,
  counterparty_account TEXT REFERENCES accounts(id),
  counterparty_wallet TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  create_tx_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agreement_versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  version INTEGER NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES accounts(id),
  terms_json TEXT NOT NULL,
  salt TEXT NOT NULL,
  agreement_nonce TEXT NOT NULL,
  sign_deadline INTEGER NOT NULL,
  agreement_hash TEXT,
  buyer_sig TEXT,
  buyer_signed_at INTEGER,
  seller_sig TEXT,
  seller_signed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','superseded','executed')),
  created_at INTEGER NOT NULL,
  UNIQUE (draft_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_version_hash ON agreement_versions(agreement_hash) WHERE agreement_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT REFERENCES accounts(id),
  claimed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_draft ON invitations(draft_id);

CREATE TABLE IF NOT EXISTS escrows (
  public_id TEXT PRIMARY KEY CHECK (public_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]' AND length(public_id) = 12),
  chain_id INTEGER NOT NULL,
  contract TEXT NOT NULL,
  on_chain_id TEXT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  agreement_hash TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  price TEXT NOT NULL,
  buyer_deposit TEXT NOT NULL,
  seller_deposit TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  funding_deadline INTEGER NOT NULL,
  handover_deadline INTEGER NOT NULL,
  buyer_response_seconds INTEGER NOT NULL,
  inspection_seconds INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'funding',
  buyer_funded INTEGER NOT NULL DEFAULT 0,
  seller_funded INTEGER NOT NULL DEFAULT 0,
  activated_at INTEGER,
  seller_declared_at INTEGER,
  handover_manifest TEXT,
  buyer_acknowledged_at INTEGER,
  buyer_accepted_at INTEGER,
  overdue_trigger INTEGER NOT NULL DEFAULT 0,
  dispute_opened_by TEXT,
  settlement_nonce INTEGER NOT NULL DEFAULT 0,
  settled_buyer_refund TEXT,
  orphaned INTEGER NOT NULL DEFAULT 0,
  creation_block INTEGER NOT NULL,
  creation_tx TEXT NOT NULL,
  UNIQUE (chain_id, contract, on_chain_id)
);
CREATE INDEX IF NOT EXISTS idx_escrows_buyer ON escrows(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_escrows_seller ON escrows(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_escrows_hash ON escrows(agreement_hash);

CREATE TABLE IF NOT EXISTS chain_events (
  chain_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL,
  block_timestamp INTEGER NOT NULL,
  contract TEXT NOT NULL,
  name TEXT NOT NULL,
  on_chain_id TEXT,
  args_json TEXT NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS idx_events_block ON chain_events(block_number);
CREATE INDEX IF NOT EXISTS idx_events_escrow ON chain_events(on_chain_id);

-- Ruling projection (V3 shape), rebuilt from chain events. One row per (contract, escrow).
-- The decision columns hold JSON so the per-party refund and flag fields can grow without an ALTER.
CREATE TABLE IF NOT EXISTS ruling_decisions (
  chain_id INTEGER NOT NULL,
  contract TEXT NOT NULL,
  on_chain_id TEXT NOT NULL,
  prelim_by TEXT,
  prelim_at INTEGER,
  appeal_deadline INTEGER,
  prelim_json TEXT,
  appealed_by TEXT,
  appealed_at INTEGER,
  appeal_reason TEXT,
  final_by TEXT,
  final_json TEXT,
  finalized_at INTEGER,
  finalized_by_appeal INTEGER,
  PRIMARY KEY (chain_id, contract, on_chain_id)
);

-- Evidence files. Bytes live in the database so a serverless deploy needs no extra storage.
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL REFERENCES escrows(public_id),
  uploader_wallet TEXT NOT NULL,
  uploader_account TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  note TEXT,
  content BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'evidence'
);
CREATE INDEX IF NOT EXISTS idx_evidence_public ON evidence(public_id, created_at);

-- Description files the Buyer attaches to a draft. Content is addressed by sha256 and never updated,
-- so a file referenced by a signed agreement cannot change.
CREATE TABLE IF NOT EXISTS draft_files (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  content BLOB NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  UNIQUE (draft_id, sha256)
);

-- Encrypted private store for evidence and description files (AES-256-GCM, one random IV per object).
-- A vault row shares its id with the evidence or draft_files row it belongs to; that row's own content column is then empty.
CREATE TABLE IF NOT EXISTS vault_objects (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('evidence','draft')),
  owner_ref TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  iv BLOB NOT NULL,
  tag BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  scan_verdict TEXT NOT NULL CHECK (scan_verdict IN ('clean','warn')),
  scan_reasons TEXT NOT NULL DEFAULT '[]',
  scanner TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_owner ON vault_objects(scope, owner_ref);

-- Access log for private files: uploads, rejected uploads, signed-link issues and downloads. Append only.
CREATE TABLE IF NOT EXISTS file_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT,
  scope TEXT NOT NULL,
  owner_ref TEXT NOT NULL,
  file_ref TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_file_log_owner ON file_log(scope, owner_ref, at);

-- Which derived notifications an account has already seen. The notifications themselves are computed from live state.
CREATE TABLE IF NOT EXISTS notification_reads (
  account_id TEXT NOT NULL,
  key TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, key)
);

-- Assistant action previews. A preview is not an authorization: it only lives 300 seconds and does nothing until the
-- signed-in account confirms it, and a wallet call still needs the wallet's own signature.
CREATE TABLE IF NOT EXISTS action_previews (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  wallet TEXT,
  chain_id INTEGER NOT NULL,
  contract TEXT NOT NULL,
  tool TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','confirmed','cancelled','stale')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_previews_account ON action_previews(account_id, created_at);

-- Plain-text reasons behind a hash that was sent onchain (ruling reasons, appeal reasons).
CREATE TABLE IF NOT EXISTS case_notes (
  hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL REFERENCES escrows(public_id),
  author_wallet TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Messages from the public contact form. No automatic reply channel exists yet (decision D01/D04 open).
CREATE TABLE IF NOT EXISTS support_requests (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  public_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_proposals (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL REFERENCES escrows(public_id),
  proposed_by TEXT NOT NULL REFERENCES accounts(id),
  buyer_price_refund TEXT NOT NULL,
  nonce TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  agreement_hash TEXT NOT NULL,
  buyer_sig TEXT,
  seller_sig TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','superseded','executed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_txs (
  tx_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_id TEXT,
  draft_id TEXT,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  account_id TEXT,
  action TEXT NOT NULL,
  subject TEXT,
  detail TEXT
);
`

async function createLibSqlDriver(): Promise<Driver> {
  const { createClient } = await import('@libsql/client')
  // A fresh client per call: @libsql/client caches prepared-statement
  // handles ("stored sql") in the client, but the server-side handles do
  // not survive a frozen-then-thawed serverless container, so a shared
  // client fails later invocations with "stored sql reference is invalid"
  // (seen 2026-11-16: the first indexer pass worked, every later pass
  // failed). createClient itself does no I/O, so per-call clients are
  // cheap; each transaction still shares one client for its lifetime.
  const newClient = () => createClient({ url: env.tursoUrl!, authToken: env.tursoAuthToken, intMode: 'number' })
  const base = {
    async get<T>(sql: string, params: SqlParams): Promise<T | null> {
      const r = await newClient().execute({ sql, args: params })
      return (r.rows[0] as unknown as T) ?? null
    },
    async all<T>(sql: string, params: SqlParams): Promise<T[]> {
      const r = await newClient().execute({ sql, args: params })
      return r.rows as unknown as T[]
    },
    async run(sql: string, params: SqlParams): Promise<RunResult> {
      const r = await newClient().execute({ sql, args: params })
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid }
    },
    async exec(sql: string): Promise<void> {
      await newClient().executeMultiple(sql)
    },
  }
  return {
    ...base,
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      const client = newClient()
      const tx = await client.transaction('write')
      const ctx: TxContext = {
        async get<U>(sql: string, params: SqlParams): Promise<U | null> {
          const r = await tx.execute({ sql, args: params })
          return (r.rows[0] as unknown as U) ?? null
        },
        async all<U>(sql: string, params: SqlParams): Promise<U[]> {
          const r = await tx.execute({ sql, args: params })
          return r.rows as unknown as U[]
        },
        async run(sql: string, params: SqlParams): Promise<RunResult> {
          const r = await tx.execute({ sql, args: params })
          return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid }
        },
      }
      try {
        const out = await txStore.run(ctx, fn)
        await tx.commit()
        return out
      } catch (err) {
        await tx.rollback().catch(() => undefined)
        throw err
      }
    },
  }
}

async function createBunDriver(): Promise<Driver> {
  // Dynamic import with a computed specifier: `bun:sqlite` does not exist
  // under Node on Vercel, and a literal specifier would also make static
  // bundlers (esbuild / Vercel's tracer) fail the build trying to resolve
  // it. This branch is only reached when no Turso URL is configured
  // (local dev), so the import never runs on Vercel.
  const specifier = ['bun', 'sqlite'].join(':')
  const { Database } = (await import(specifier)) as typeof import('bun:sqlite')
  mkdirSync(dirname(env.dbPath), { recursive: true })
  const db = new Database(env.dbPath, { create: true })
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  // The local file DB is one connection: serialize multi-statement
  // transactions so concurrent requests cannot interleave inside BEGIN..COMMIT.
  let txQueue: Promise<unknown> = Promise.resolve()
  const base = {
    async get<T>(sql: string, params: SqlParams): Promise<T | null> {
      return (db.query(sql).get(...params) as T | null) ?? null
    },
    async all<T>(sql: string, params: SqlParams): Promise<T[]> {
      return db.query(sql).all(...params) as T[]
    },
    async run(sql: string, params: SqlParams): Promise<RunResult> {
      const r = db.query(sql).run(...params)
      return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }
    },
    async exec(sql: string): Promise<void> {
      db.exec(sql)
    },
  }
  return {
    ...base,
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      const run = txQueue.then(async () => {
        db.exec('BEGIN IMMEDIATE')
        try {
          // Queries inside the callback run on this same connection, so the
          // transaction context just delegates to the base helpers.
          const out = await txStore.run(base, fn)
          db.exec('COMMIT')
          return out
        } catch (err) {
          try {
            db.exec('ROLLBACK')
          } catch {
            /* already rolled back */
          }
          throw err
        }
      })
      // Keep the queue alive even if this transaction fails.
      txQueue = run.catch(() => undefined)
      return run
    },
  }
}

let driverPromise: Promise<Driver> | null = null
let schemaPromise: Promise<void> | null = null

async function getDriver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = (async () => {
      const driver = env.tursoUrl ? await createLibSqlDriver() : await createBunDriver()
      return driver
    })()
  }
  return driverPromise
}

/** Create the schema if needed. Idempotent; safe to call on every cold start. */
export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const driver = await getDriver()
      await driver.exec(SCHEMA)
      // Databases created before delivery proofs have no `kind` column. Safe to run on every cold start: a second
      // instance racing us, or a database that already has the column, answers "duplicate column" and we move on.
      try {
        await driver.exec("ALTER TABLE evidence ADD COLUMN kind TEXT NOT NULL DEFAULT 'evidence'")
      } catch (err) {
        if (!/duplicate column|already exists/i.test(String(err))) throw err
      }
    })()
  }
  return schemaPromise
}

export async function dbGet<T>(sql: string, ...params: SqlParams): Promise<T | null> {
  const tx = txStore.getStore()
  if (tx) return tx.get<T>(sql, params)
  await ensureSchema()
  return (await getDriver()).get<T>(sql, params)
}

export async function dbAll<T>(sql: string, ...params: SqlParams): Promise<T[]> {
  const tx = txStore.getStore()
  if (tx) return tx.all<T>(sql, params)
  await ensureSchema()
  return (await getDriver()).all<T>(sql, params)
}

export async function dbRun(sql: string, ...params: SqlParams): Promise<RunResult> {
  const tx = txStore.getStore()
  if (tx) return tx.run(sql, params)
  await ensureSchema()
  return (await getDriver()).run(sql, params)
}

export async function dbExec(sql: string): Promise<void> {
  const tx = txStore.getStore()
  if (tx) throw new Error('dbExec is not supported inside a transaction')
  await ensureSchema()
  return (await getDriver()).exec(sql)
}

/** Run `fn` atomically. Nested dbGet/dbAll/dbRun calls inside `fn` use the transaction. */
export async function dbTx<T>(fn: () => Promise<T> | T): Promise<T> {
  await ensureSchema()
  // Already inside a transaction (e.g. rebuildProjections during a reorg):
  // join it instead of opening a nested one, which both drivers reject.
  if (txStore.getStore()) return fn()
  const driver = await getDriver()
  return driver.tx(() => Promise.resolve(fn()))
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

export async function audit(accountId: string | null, action: string, subject?: string, detail?: unknown): Promise<void> {
  await dbRun(
    'INSERT INTO audit_log (at, account_id, action, subject, detail) VALUES (?, ?, ?, ?, ?)',
    nowSec(),
    accountId,
    action,
    subject ?? null,
    detail === undefined ? null : JSON.stringify(detail),
  )
}

export async function getState(key: string): Promise<string | undefined> {
  const row = await dbGet<{ value: string }>('SELECT value FROM indexer_state WHERE key = ?', key)
  return row?.value
}

export async function setState(key: string, value: string): Promise<void> {
  await dbRun(
    'INSERT INTO indexer_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  )
}
