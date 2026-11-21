import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'
import { FAQ } from '@/content/faq'

export default function Faq() {
  const { lang, tr } = useLang()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Hỏi đáp', 'FAQ')}</h1>
        {lang === 'en' && <p className="mt-2 text-sm text-[var(--muted)]">English is a reference translation. The Vietnamese text controls until the project owner names a translation reviewer (decision D10).</p>}
      </header>
      {FAQ.map((g) => (
        <section key={g.group} className="space-y-2">
          <h2 className="display text-lg font-bold">{lang === 'en' ? g.groupEn : g.group}</h2>
          {g.items.map((it) => (
            <details key={it.q} className="card p-4">
              <summary className="cursor-pointer font-semibold">{lang === 'en' ? it.qEn : it.q}</summary>
              <p className="mt-2 text-sm text-[var(--ink-2)]">{lang === 'en' ? it.aEn : it.a}</p>
              <Link to={it.to} className="mt-2 inline-block text-sm font-semibold text-[var(--accent-hover)] underline">{tr('Xem bài chính thức', 'Official article')}</Link>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}
