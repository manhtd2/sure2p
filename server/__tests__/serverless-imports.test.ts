import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The serverless bundle cannot resolve the `@/` alias, so one stray alias import anywhere under the API entry
 * crashes every route at load time (FUNCTION_INVOCATION_FAILED). This walks the real import graph to catch it.
 */
describe('serverless entry', () => {
  it('reaches no alias import and every relative import resolves', () => {
    const seen = new Set<string>()
    const problems: string[] = []
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g)) {
        const spec = (m[1] ?? m[2])!
        if (spec.startsWith('@/')) problems.push(`${file}: alias import ${spec}`)
        if (!spec.startsWith('.')) continue
        const base = resolve(dirname(file), spec)
        const hit = [base.replace(/\.js$/, '.ts'), base + '.ts'].find((c) => existsSync(c))
        if (hit) visit(hit)
        else if (!existsSync(base)) problems.push(`${file}: cannot resolve ${spec}`)
      }
    }
    visit(resolve(__dirname, '../vercelHandler.ts'))
    expect(problems).toEqual([])
    expect(seen.size).toBeGreaterThan(20)
  })
})
