import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useLang } from '@/i18n'
import { useSession } from '@/hooks/useSession'
import { MockBanner } from './MockBanner'

/** Shell for the public, no-login pages: how it works, trust, docs, policies, status. */
export function PublicLayout() {
  const { lang, setLang, tr } = useLang()
  const { me, signedIn } = useSession()
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-white/80 text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`

  const groups: Array<{ title: string; links: Array<[string, string, string]> }> = [
    {
      title: tr('Sản phẩm', 'Product'),
      links: [
        ['/how-it-works', 'Cách hoạt động', 'How it works'],
        ['/fees', 'Phí', 'Fees'],
        ['/transactions/new', 'Tạo giao dịch', 'Create a deal'],
      ],
    },
    {
      title: tr('Tìm hiểu', 'Learn'),
      links: [
        ['/docs', 'Tài liệu', 'Docs'],
        ['/faq', 'Hỏi đáp', 'FAQ'],
        ['/contact', 'Liên hệ', 'Contact'],
      ],
    },
    {
      title: tr('Minh bạch', 'Transparency'),
      links: [
        ['/trust', 'Tin cậy', 'Trust'],
        ['/status', 'Trạng thái', 'Status'],
        ['/security', 'Bảo mật', 'Security'],
      ],
    },
    {
      title: tr('Pháp lý', 'Legal'),
      links: [
        ['/privacy', 'Riêng tư', 'Privacy'],
        ['/terms', 'Điều khoản', 'Terms'],
        ['/risk-disclosure', 'Cảnh báo rủi ro', 'Risk disclosure'],
        ['/dispute-policy', 'Chính sách tranh chấp', 'Dispute policy'],
        ['/evidence-policy', 'Chính sách bằng chứng', 'Evidence policy'],
      ],
    },
    {
      title: tr('Cập nhật', 'Updates'),
      links: [['/changelog', 'Nhật ký thay đổi', 'Changelog']],
    },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <MockBanner otpProvider={me?.otpProvider} />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        {tr('Bỏ qua tới nội dung', 'Skip to content')}
      </a>
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
              <ShieldCheck className="size-4" />
            </span>
            <span className="display text-lg font-bold">sure2p</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label={tr('Điều hướng chính', 'Main')}>
            <NavLink to="/how-it-works" className={link}>{tr('Cách hoạt động', 'How it works')}</NavLink>
            <NavLink to="/trust" className={link}>{tr('Tin cậy', 'Trust')}</NavLink>
            <NavLink to="/docs" className={link}>{tr('Tài liệu', 'Docs')}</NavLink>
            <NavLink to="/faq" className={link}>{tr('Trợ giúp', 'Help')}</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <span className="chip hidden sm:inline-flex" title={tr('Chỉ chạy trên mạng thử nghiệm', 'Testnet only')}>
              <span className="size-1.5 rounded-full bg-[var(--success)]" aria-hidden />
              {tr('Mạng thử nghiệm Arc', 'Arc Testnet')}
            </span>
            <button
              type="button"
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              className="btn btn-ghost !min-h-9 !px-3 text-xs"
              aria-label={tr('Đổi ngôn ngữ', 'Switch language')}
            >
              {lang === 'vi' ? 'EN' : 'VI'}
            </button>
            <Link to={signedIn ? '/transactions' : '/sign-in'} className="btn btn-primary !min-h-9 !px-4 text-xs">
              {tr('Mở ứng dụng', 'Open app')}
            </Link>
          </div>
        </div>
        <nav className="flex items-center justify-center gap-1 border-t border-[var(--border)] px-2 py-1 md:hidden" aria-label={tr('Điều hướng', 'Navigate')}>
          <NavLink to="/how-it-works" className={link}>{tr('Cách hoạt động', 'How it works')}</NavLink>
          <NavLink to="/trust" className={link}>{tr('Tin cậy', 'Trust')}</NavLink>
          <NavLink to="/docs" className={link}>{tr('Tài liệu', 'Docs')}</NavLink>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-[var(--border)] bg-white/60">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-3 lg:grid-cols-5">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="label">{g.title}</p>
              <ul className="space-y-1.5 text-sm">
                {g.links.map(([to, vi, en]) => (
                  <li key={to}>
                    <Link to={to} className="text-[var(--ink-2)] hover:underline">{tr(vi, en)}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-[var(--subtle)]">
          {tr(
            'sure2p chỉ chạy trên mạng thử nghiệm Arc. Giao hàng diễn ra ngoài sure2p; sure2p không giao, lưu hay xác minh hàng hóa.',
            'sure2p runs on Arc Testnet only. Goods are exchanged outside sure2p; sure2p does not deliver, store or verify them.',
          )}
        </p>
      </footer>
    </div>
  )
}

