import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDisconnect } from 'wagmi'
import { LogOut, ShieldCheck } from 'lucide-react'
import { useLang } from '@/i18n'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'
import { shortAddress } from '@/lib/format'
import { MockBanner } from './MockBanner'

export function Layout() {
  const { lang, setLang, tr } = useLang()
  const { me, signedIn } = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { disconnect } = useDisconnect()
  // The console link only appears for the wallet that holds a ruling role onchain.
  const adminRole = useQuery({
    queryKey: ['admin-me', me?.wallet ?? null],
    queryFn: () => api<{ role: 'arbiter' | 'reviewer' | null }>('/admin/me'),
    enabled: signedIn && Boolean(me?.wallet),
    staleTime: 30_000,
    retry: false,
  }).data?.role

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} })
    } finally {
      disconnect()
      qc.clear()
      void navigate('/')
    }
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-white/80 text-[var(--ink)]' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`

  return (
    <div className="flex min-h-dvh flex-col">
      <MockBanner otpProvider={me?.otpProvider} />
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
              <ShieldCheck className="size-4" />
            </span>
            <span className="display text-lg font-bold">sure2p</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            <NavLink to="/transactions" className={link}>
              {tr('Giao dịch', 'Transactions')}
            </NavLink>
            <NavLink to="/transactions/new" className={link}>
              {tr('Tạo mới', 'Create')}
            </NavLink>
            <NavLink to="/join" className={link}>
              {tr('Tham gia', 'Join')}
            </NavLink>
            {adminRole && (
              <NavLink to="/admin" className={link}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
              className="btn btn-ghost !min-h-9 !px-3 text-xs"
              aria-label={tr('Đổi ngôn ngữ', 'Switch language')}
            >
              {lang === 'vi' ? 'EN' : 'VI'}
            </button>
            {signedIn ? (
              <button type="button" onClick={() => void signOut()} className="btn btn-ghost !min-h-9 !px-3 text-xs" title={tr('Đăng xuất', 'Sign out')}>
                <span className="mono">{shortAddress(me?.wallet) === '-' ? tr('Chưa có ví', 'No wallet') : shortAddress(me?.wallet)}</span>
                <LogOut className="size-3.5" />
              </button>
            ) : (
              <Link to="/sign-in" className="btn btn-primary !min-h-9 !px-4 text-xs">
                {tr('Đăng nhập', 'Sign in')}
              </Link>
            )}
          </div>
        </div>
        <nav className="flex items-center justify-center gap-1 border-t border-[var(--border)] px-2 py-1 sm:hidden">
          <NavLink to="/transactions" className={link}>
            {tr('Giao dịch', 'Transactions')}
          </NavLink>
          <NavLink to="/transactions/new" className={link}>
            {tr('Tạo mới', 'Create')}
          </NavLink>
          <NavLink to="/join" className={link}>
            {tr('Tham gia', 'Join')}
          </NavLink>
          {adminRole && (
            <NavLink to="/admin" className={link}>
              Admin
            </NavLink>
          )}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 text-xs text-[var(--subtle)]">
        {tr(
          'sure2p chỉ chạy trên Arc Testnet. Giao hàng diễn ra ngoài sure2p; sure2p không giao hay xác minh hàng hóa.',
          'sure2p runs on Arc Testnet only. Goods are exchanged outside sure2p; sure2p does not deliver or verify them.',
        )}
      </footer>
    </div>
  )
}
