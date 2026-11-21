import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { useLang } from '@/i18n'
import { Blocks, headings } from '@/content/blocks'
import { DOCS, DOC_REVIEWED, DOC_VERSION, GROUP_TITLES, GROUP_TITLES_EN, docByCode, docByPath, docHref, docSearchText, localize, type DocGroup } from '@/content/docs'

export default function Docs() {
  const { '*': splat } = useParams()
  const { lang, tr } = useLang()
  const [q, setQ] = useState('')
  const path = (splat ?? '').replace(/\/$/, '')
  const doc = docByPath(path)

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return null
    return DOCS.filter((d) => docSearchText(d, lang).includes(needle))
  }, [q, lang])

  const groupTitles = lang === 'en' ? GROUP_TITLES_EN : GROUP_TITLES
  const groups = (Object.keys(GROUP_TITLES) as DocGroup[]).map((g) => ({ g, docs: DOCS.filter((d) => d.group === g) }))

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <label className="relative block">
          <span className="sr-only">{tr('Tìm trong tài liệu', 'Search docs')}</span>
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[var(--muted)]" aria-hidden />
          <input className="field !pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Tìm trong tài liệu', 'Search docs')} />
        </label>
        <nav className="mt-4 space-y-4 rounded-2xl bg-[var(--accent)] p-4 text-white" aria-label={tr('Mục lục tài liệu', 'Docs menu')}>
          {groups.map(({ g, docs }) => (
            <div key={g}>
              <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-white/60">{groupTitles[g]}</p>
              <ul className="space-y-0.5">
                {docs.map((d) => (
                  <li key={d.code}>
                    <Link
                      to={docHref(d)}
                      className={`block rounded-lg px-2 py-1 text-sm hover:bg-white/10 ${doc?.code === d.code ? 'bg-white/15 font-semibold' : 'text-white/85'}`}
                    >
                      {localize(d, lang).title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <section className="min-w-0">
        {lang === 'en' && (
          <p className="mb-4 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] p-3 text-sm">
            English is a reference translation. The Vietnamese text is the controlling version until the project owner names who reviews translations (decision D10).
          </p>
        )}
        {hits ? (
          <div className="card p-5">
            <h1 className="display text-xl font-bold">{tr('Kết quả tìm kiếm', 'Search results')}</h1>
            {hits.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">{tr('Không có bài nào khớp.', 'No articles match.')}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {hits.map((d) => (
                  <li key={d.code}>
                    <Link to={docHref(d)} className="font-semibold text-[var(--accent-hover)] underline" onClick={() => setQ('')}>{localize(d, lang).title}</Link>
                    <p className="text-sm text-[var(--muted)]">{localize(d, lang).summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : path === '' ? (
          <DocsHome />
        ) : doc ? (
          <Article path={path} />
        ) : (
          <div className="card p-6">
            <h1 className="display text-xl font-bold">{tr('Không tìm thấy bài tài liệu', 'Article not found')}</h1>
            <Link to="/docs" className="mt-3 inline-block font-semibold text-[var(--accent-hover)] underline">{tr('Về trang tài liệu', 'Back to docs')}</Link>
          </div>
        )}
      </section>
    </div>
  )
}

function Article({ path }: { path: string }) {
  const { tr, lang } = useLang()
  const d = docByPath(path)
  if (!d) return null
  const L = localize(d, lang)
  const toc = headings(L.blocks)
  const related = d.related.map(docByCode).filter((x): x is NonNullable<typeof x> => Boolean(x))
  return (
    <article className="card p-6">
      <p className="label">{(lang === 'en' ? GROUP_TITLES_EN : GROUP_TITLES)[d.group]} · {d.code}</p>
      <h1 className="display text-2xl font-bold">{L.title}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">{L.summary}</p>
      <p className="mono mt-2 text-xs text-[var(--subtle)]">
        {tr('Phiên bản', 'Version')} {DOC_VERSION} · {tr('Rà soát', 'Reviewed')} {DOC_REVIEWED} · {tr('Nguồn đặc tả', 'Spec')} {d.spec} · {d.priority}
      </p>
      {toc.length > 1 && (
        <nav className="inner mt-4 p-3 text-sm" aria-label={tr('Trong bài này', 'On this page')}>
          <p className="label">{tr('Trong bài này', 'On this page')}</p>
          <ul className="space-y-1">
            {toc.map((t) => (
              <li key={t.id}><a href={`#${t.id}`} className="text-[var(--accent-hover)] underline">{t.text}</a></li>
            ))}
          </ul>
        </nav>
      )}
      <div className="mt-5"><Blocks blocks={L.blocks} /></div>
      {related.length > 0 && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <p className="label">{tr('Bài liên quan', 'Related')}</p>
          <ul className="flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.code}><Link to={docHref(r)} className="chip hover:underline">{localize(r, lang).title}</Link></li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}

/** The docs home shows DOC01 followed by the article index. */
export function DocsHome() {
  const { tr, lang } = useLang()
  const home = docByPath('')
  return (
    <div className="space-y-5">
      {home && <Article path="" />}
      <div className="card p-5">
        <h2 className="display text-lg font-bold">{tr('Tất cả bài tài liệu', 'All articles')}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DOCS.filter((d) => d.path !== '').map((d) => (
            <li key={d.code} className="inner p-3">
              <Link to={docHref(d)} className="font-semibold text-[var(--accent-hover)] underline">{localize(d, lang).title}</Link>
              <p className="text-xs text-[var(--muted)]">{localize(d, lang).summary}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
