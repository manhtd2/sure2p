import { Link } from 'react-router-dom'
import { AlertTriangle, Clock } from 'lucide-react'
import type { ReactNode } from 'react'

/** Long-form content as data, so docs and policy pages share one renderer and one search index. */
export type Block =
  | { h: string }
  | { p: string }
  | { ul: string[] }
  | { steps: string[] }
  | { code: string }
  | { warn: string }
  /** A value the project owner has not decided yet. Rendered as a labelled gap, never filled in. */
  | { pending: string; text: string }
  | { link: string; to: string }

export function blockText(b: Block): string {
  if ('h' in b) return b.h
  if ('p' in b) return b.p
  if ('ul' in b) return b.ul.join(' ')
  if ('steps' in b) return b.steps.join(' ')
  if ('code' in b) return b.code
  if ('warn' in b) return b.warn
  if ('pending' in b) return b.text
  return b.link
}

export function Blocks({ blocks }: { blocks: Block[] }): ReactNode {
  return (
    <div className="space-y-3 text-[0.95rem] leading-relaxed text-[var(--ink-2)]">
      {blocks.map((b, i) => {
        if ('h' in b) return <h3 key={i} id={slug(b.h)} className="display pt-3 text-lg font-bold text-[var(--ink)]">{b.h}</h3>
        if ('p' in b) return <p key={i}>{b.p}</p>
        if ('ul' in b)
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.ul.map((x, j) => <li key={j}>{x}</li>)}
            </ul>
          )
        if ('steps' in b)
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.steps.map((x, j) => <li key={j}>{x}</li>)}
            </ol>
          )
        if ('code' in b) return <pre key={i} className="mono overflow-x-auto rounded-xl bg-[var(--surface-muted)] p-3 text-xs">{b.code}</pre>
        if ('warn' in b)
          return (
            <div key={i} className="flex gap-2 rounded-xl border border-[#e6c27a] bg-[#fff8e6] p-3 text-sm text-[var(--warn)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{b.warn}</span>
            </div>
          )
        if ('pending' in b)
          return (
            <div key={i} className="flex gap-2 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] p-3 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-[var(--muted)]" aria-hidden />
              <span>
                <strong>Chờ chốt ({b.pending}):</strong> {b.text}
              </span>
            </div>
          )
        return (
          <p key={i}>
            <Link to={b.to} className="font-semibold text-[var(--accent-hover)] underline">{b.link}</Link>
          </p>
        )
      })}
    </div>
  )
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function headings(blocks: Block[]): Array<{ id: string; text: string }> {
  return blocks.filter((b): b is { h: string } => 'h' in b).map((b) => ({ id: slug(b.h), text: b.h }))
}
