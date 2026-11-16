/** Minimal ambient types for the Bun APIs the API server uses, so the browser typecheck is not polluted. */
declare module 'bun:sqlite' {
  export interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }
  export interface Statement {
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): RunResult
  }
  export class Database {
    constructor(path: string, options?: { create?: boolean })
    exec(sql: string): void
    query(sql: string): Statement
    transaction<T>(fn: () => T): () => T
  }
}

declare const Bun: {
  serve(options: { port: number; hostname?: string; fetch: (req: Request) => Response | Promise<Response> }): { port: number }
}

interface ImportMeta {
  dir: string
}
