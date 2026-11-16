import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, FileSignature, HandCoins, Lock, PackageCheck, Scale, ShieldCheck } from 'lucide-react'
import { useLang } from '@/i18n'
import { AmountBreakdown } from '@/components/AmountBreakdown'
import { useSession } from '@/hooks/useSession'

export default function Landing() {
  const { tr } = useLang()
  const { signedIn } = useSession()
  const steps = [
    {
      icon: FileSignature,
      title: tr('1. Thỏa thuận', '1. Agree'),
      body: tr(
        'Buyer hoặc Seller tạo đề xuất và mời đối tác bằng liên kết, mã hoặc QR. Hai bên ký cùng một thỏa thuận.',
        'Either side creates a proposal and invites the other by link, code or QR. Both sign the same agreement.',
      ),
    },
    {
      icon: Lock,
      title: tr('2. Ký quỹ', '2. Escrow'),
      body: tr(
        'Buyer nạp 100% giá cộng cọc 25%, Seller nạp cọc 25%. Giao dịch chỉ bắt đầu khi cả hai đã nạp đủ.',
        'Buyer funds 100% of the price plus a 25% deposit, Seller funds a 25% deposit. The deal starts only when both are fully funded.',
      ),
    },
    {
      icon: PackageCheck,
      title: tr('3. Giao hàng ngoài sure2p', '3. Deliver outside sure2p'),
      body: tr(
        'Seller giao hàng qua kênh hai bên đã thống nhất rồi khai báo. Buyer xác nhận đã nhận và chấp nhận.',
        'The Seller delivers through the agreed channel and declares it. The Buyer confirms receipt and acceptance.',
      ),
    },
    {
      icon: HandCoins,
      title: tr('4. Nhận tiền', '4. Claim'),
      body: tr(
        'Seller nhận 100% giá, cả hai nhận lại khoản cọc. Mỗi bên tự bấm Claim để chuyển về ví.',
        'The Seller gets 100% of the price and both get their deposits back. Each side claims to their own wallet.',
      ),
    },
  ]
  return (
    <div className="space-y-10">
      <section className="grid items-center gap-8 md:grid-cols-[1.15fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }}>
          <span className="chip mb-4">
            <ShieldCheck className="size-3.5" /> Arc Testnet
          </span>
          <h1 className="display text-balance text-4xl font-bold leading-[1.05] sm:text-5xl">
            {tr('Mua bán hàng số an tâm với tiền được khóa sẵn.', 'Trade digital goods with the money already locked.')}
          </h1>
          <p className="mt-4 max-w-prose text-pretty text-[var(--ink-2)]">
            {tr(
              'sure2p giữ 100% giá và hai khoản cọc 25% trong hợp đồng thông minh trước khi giao dịch bắt đầu. Hàng hóa được trao đổi bên ngoài sure2p; tiền không đến Seller trước khi cả hai bên xác nhận.',
              'sure2p holds 100% of the price and two 25% deposits in a smart contract before the deal starts. Goods are exchanged outside sure2p; the Seller gets nothing before both sides confirm.',
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={signedIn ? '/transactions/new' : '/sign-in'} className="btn btn-primary">
              {signedIn ? tr('Tạo giao dịch', 'Create a transaction') : tr('Bắt đầu', 'Get started')} <ArrowRight className="size-4" />
            </Link>
            <Link to="/join" className="btn btn-ghost">
              {tr('Tôi có mã mời', 'I have an invite')}
            </Link>
          </div>
        </motion.div>
        <div className="card p-5">
          <div className="label">{tr('Ví dụ minh họa: giá 100 USDC', 'Illustration: a 100 USDC price')}</div>
          <AmountBreakdown priceUnits={100_000_000n} />
          <p className="mt-3 text-xs text-[var(--muted)]">
            {tr(
              'Thanh thời gian trong giao dịch chỉ để hiển thị. Đó không phải chuyển tiền từng phần và Seller không rút được gì trước khi hoàn tất.',
              'The time bar inside a deal is informational only. It is not a gradual transfer and the Seller can withdraw nothing before completion.',
            )}
          </p>
        </div>
      </section>

      <section aria-label={tr('Cách hoạt động', 'How it works')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <div key={s.title} className="card p-5">
            <s.icon className="mb-3 size-5 text-[var(--accent-hover)]" />
            <h2 className="display text-base font-semibold">{s.title}</h2>
            <p className="mt-1.5 text-sm text-[var(--muted)]">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="card flex flex-col gap-3 p-6 sm:flex-row sm:items-start">
        <Scale className="mt-1 size-5 shrink-0 text-[var(--accent-hover)]" />
        <div className="text-sm text-[var(--ink-2)]">
          <h2 className="display text-base font-semibold text-[var(--ink)]">{tr('Giới hạn cần biết trước khi ký', 'Limits to know before you sign')}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>{tr('Không có khoản nào tự động được giải phóng khi hết giờ hoặc khi một bên im lặng: quá hạn hoặc tranh chấp sẽ khóa tiền.', 'Nothing is released automatically when a deadline passes or someone is silent: overdue or disputed deals lock the funds.')}</li>
            <li>{tr('Phiên bản này chưa có Admin phân xử. Tiền bị khóa chỉ thoát bằng thỏa thuận chung do cả hai bên ký.', 'This release has no Admin adjudication yet. Locked funds exit only through a mutual settlement signed by both sides.')}</li>
            <li>{tr('sure2p không giao hoặc xác minh hàng hóa, và OTP điện thoại không chứng minh một người duy nhất.', 'sure2p does not deliver or verify goods, and a phone OTP does not prove a unique person.')}</li>
            <li>{tr('Phí gas trả bằng USDC. Mất khóa ví nghĩa là mất quyền nhận tiền.', 'Gas is paid in USDC. Losing your wallet key means losing the right to claim.')}</li>
          </ul>
        </div>
      </section>
    </div>
  )
}
