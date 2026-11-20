import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useDisconnect } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { useLang } from '@/i18n'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'

/** Account page (spec 6.2): masked phone, status, the one linked wallet and how to leave. */
export default function Account() {
  const { lang, setLang, tr } = useLang()
  const { me } = useSession()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { disconnect } = useDisconnect()
  const explorer = 'https://explorer.testnet.arc.io'

  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST', body: {} })
    } finally {
      disconnect()
      qc.clear()
      void navigate('/')
    }
  }

  const status = me?.accountStatus ?? 'active'
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="display text-2xl font-bold">{tr('Tài khoản', 'Account')}</h1>

      <section className="card space-y-3 p-5">
        <div>
          <p className="label">{tr('Số điện thoại', 'Phone')}</p>
          <p className="mono">{me?.phoneMasked ?? tr('Không hiển thị', 'Not shown')}</p>
        </div>
        <div>
          <p className="label">{tr('Trạng thái', 'Status')}</p>
          <p className="font-semibold">
            {status === 'active' ? tr('Đang hoạt động', 'Active') : status === 'limited' ? tr('Bị hạn chế', 'Limited') : tr('Bị cấm tạo giao dịch mới', 'Banned from new deals')}
          </p>
          {status !== 'active' && (
            <p className="mt-1 text-sm text-[var(--ink-2)]">
              {tr(
                'Bạn vẫn xem được hồ sơ cũ và nhận được các khoản tiền hợp lệ của giao dịch đã có. Bạn không mở hay tham gia giao dịch mới.',
                'You can still view past deals and claim valid funds from existing ones. You cannot open or join new deals.',
              )}
            </p>
          )}
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <div>
          <p className="label">{tr('Ví đang ký', 'Signing wallet')}</p>
          {me?.wallet ? (
            <a className="mono inline-flex items-center gap-1 break-all underline" href={`${explorer}/address/${me.wallet}`} target="_blank" rel="noreferrer">
              {me.wallet}
              <ExternalLink className="size-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <p className="text-sm text-[var(--muted)]">{tr('Chưa liên kết ví.', 'No wallet linked yet.')} <Link to="/sign-in" className="underline">{tr('Liên kết ví', 'Link a wallet')}</Link></p>
          )}
        </div>
        <p className="text-sm text-[var(--ink-2)]">
          {tr(
            'Ví nhận tiền của mỗi giao dịch được cố định trong thỏa thuận đã ký. Không có chức năng đổi ví nhận tiền cho giao dịch đã ký, và mã xác thực không phải cách khôi phục ví.',
            'The payout wallet of each deal is fixed in the signed agreement. There is no way to change it for a signed deal, and an OTP code is not a wallet recovery method.',
          )}
        </p>
        <p className="text-xs text-[var(--muted)]">
          {tr('Mạng', 'Network')}: Arc Testnet ({me?.chainId ?? 5042002})
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <div>
          <p className="label">{tr('Ngôn ngữ', 'Language')}</p>
          <div className="flex gap-2">
            <button type="button" className={`btn ${lang === 'vi' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLang('vi')}>Tiếng Việt</button>
            <button type="button" className={`btn ${lang === 'en' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-[var(--border)] pt-3">
          <Link to="/transactions" className="btn btn-ghost">{tr('Giao dịch và khoản chờ nhận', 'Deals and pending claims')}</Link>
          <button type="button" className="btn btn-danger" onClick={() => void signOut()}>{tr('Đăng xuất', 'Sign out')}</button>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {tr('Yêu cầu về dữ liệu cá nhân (truy cập, sửa, xóa):', 'Personal data requests (access, correction, deletion):')} <Link to="/contact" className="underline">{tr('gửi qua trang Liên hệ', 'send via Contact')}</Link>.
        </p>
      </section>
    </div>
  )
}
