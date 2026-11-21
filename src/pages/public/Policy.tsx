import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'
import { Blocks } from '@/content/blocks'
import { POLICIES } from '@/content/policies'
import { POLICIES_EN } from '@/content/policiesEn'
import { POLICY_HASH, POLICY_VERSION } from '@/shared/protocol'

/** One renderer for every policy page. C22: shows the version and hash that signers commit to. */
export default function Policy({ id }: { id: keyof typeof POLICIES }) {
  const { lang, tr } = useLang()
  const base = POLICIES[id]
  const en = lang === 'en' ? POLICIES_EN[id] : undefined
  const p = { ...base, ...(en ?? {}) }
  return (
    <article className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="display text-3xl font-bold">{p.title}</h1>
        <p className="mt-1 text-[var(--muted)]">{p.summary}</p>
      </header>
      <div className="inner flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
        <span>
          {tr('Phiên bản chính sách ký', 'Signed policy version')}: <span className="mono">{POLICY_VERSION}</span>
        </span>
        <span className="mono break-all text-[var(--muted)]" title="policyHash">{POLICY_HASH}</span>
      </div>
      {p.draft && <p className="rounded-xl bg-[#fff8e6] p-3 text-sm text-[var(--warn)]">{tr('Bản dự thảo chờ duyệt pháp lý.', 'Draft pending legal review.')}</p>}
      {lang === 'en' && (
        <p className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] p-3 text-sm">
          {en ? 'English is a reference translation. The Vietnamese text is the controlling version until the project owner names who reviews translations (decision D10).' : 'English translation pending (decision D10). The text below is the Vietnamese version.'}
        </p>
      )}
      <div className="card p-6"><Blocks blocks={p.blocks} /></div>
      <p className="text-sm">
        <Link to="/contact" className="underline">{tr('Có câu hỏi? Liên hệ', 'Questions? Contact us')}</Link>
      </p>
    </article>
  )
}
