import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'

const FAQ: Array<{ group: string; items: Array<{ q: string; a: string; to: string }> }> = [
  { group: 'Tài khoản và ví', items: [
    { q: 'Tôi đăng nhập thế nào?', a: 'Bằng số điện thoại và mã xác thực, rồi ký một thử thách để chứng minh ví. Chỉ kết nối ví thì chưa đủ.', to: '/docs/getting-started/account-wallet' },
    { q: 'Tôi đổi được ví nhận tiền không?', a: 'Không, với giao dịch đã ký. Ví nhận tiền được cố định trong thỏa thuận.', to: '/docs/getting-started/account-wallet' },
    { q: 'Tôi mất khóa ví thì sao?', a: 'sure2p không khôi phục được ví hay đổi ví nhận tiền. Không bao giờ gửi cụm từ khôi phục cho ai.', to: '/risk-disclosure' },
  ] },
  { group: 'Nạp tiền và cọc', items: [
    { q: 'Tôi phải nạp bao nhiêu?', a: 'Người mua nạp giá cộng cọc 25%, người bán nạp cọc 25%. Cọc làm tròn lên. Giá 100 thì người mua 125, người bán 25.', to: '/docs/trading/how-escrow-works' },
    { q: 'Nếu bên kia không nạp?', a: 'Sau 24 giờ ai cũng gọi được lệnh hết hạn; mọi khoản đã nạp trở thành số chờ nhận về ví gốc, không phạt.', to: '/docs/trading/funding' },
  ] },
  { group: 'Giao hàng', items: [
    { q: 'sure2p có giao hay giữ hàng không?', a: 'Không. Hàng được trao đổi ngoài ứng dụng; sure2p không truyền, lưu hay xác minh hàng.', to: '/docs/trading/handover-acceptance' },
    { q: 'Tuyên bố bàn giao của người bán có đủ không?', a: 'Không. Chỉ xác nhận và chấp thuận của người mua mới đưa giao dịch tới chốt.', to: '/docs/trading/handover-acceptance' },
  ] },
  { group: 'Chốt và nhận tiền', items: [
    { q: 'Người bán nhận bao nhiêu nếu xong sớm?', a: 'Đủ 100% giá, cộng cọc của mình. Không chia theo thời gian.', to: '/docs/trading/settlement-claims' },
    { q: 'Vì sao tiền chưa vào ví dù đã chốt?', a: 'Chốt chỉ ghi có. Mỗi ví phải tự bấm nhận bằng một giao dịch riêng.', to: '/docs/trading/settlement-claims' },
  ] },
  { group: 'Tranh chấp và kháng nghị', items: [
    { q: 'Quá hạn thì tiền đi đâu?', a: 'Bị khóa. Không có giải ngân tự động vì im lặng hay hết giờ.', to: '/docs/disputes/overdue' },
    { q: 'Tôi kháng nghị được mấy lần?', a: 'Một vòng chung trong 72 giờ sau phán quyết sơ bộ. Phán quyết kháng nghị là chung cuộc.', to: '/docs/disputes/rulings-appeals' },
    { q: 'Hai bên tự thỏa thuận được không?', a: 'Được, trước phán quyết cuối: hoàn đủ hai cọc, không phạt, cần chữ ký của cả hai.', to: '/docs/trading/mutual-settlement' },
  ] },
  { group: 'Riêng tư', items: [
    { q: 'Ai xem được bằng chứng của tôi?', a: 'Chỉ hai bên và người phán quyết hoặc người xem xét được giao. Không công khai.', to: '/evidence-policy' },
    { q: 'Dữ liệu của tôi nằm ở đâu?', a: 'Dữ liệu riêng tư ở cơ sở dữ liệu máy chủ; chỉ mã băm và dữ liệu giao dịch nằm trên chuỗi công khai.', to: '/privacy' },
  ] },
  { group: 'Trợ lý', items: [
    { q: 'sure2p có trợ lý AI không?', a: 'Chưa. Trợ lý chưa được xây trong bản này; mọi thao tác làm thủ công.', to: '/docs/ai-copilot' },
  ] },
]

export default function Faq() {
  const { lang, tr } = useLang()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Hỏi đáp', 'FAQ')}</h1>
        {lang === 'en' && <p className="mt-2 text-sm text-[var(--muted)]">English translation pending (decision D10). Answers are in Vietnamese.</p>}
      </header>
      {FAQ.map((g) => (
        <section key={g.group} className="space-y-2">
          <h2 className="display text-lg font-bold">{g.group}</h2>
          {g.items.map((it) => (
            <details key={it.q} className="card p-4">
              <summary className="cursor-pointer font-semibold">{it.q}</summary>
              <p className="mt-2 text-sm text-[var(--ink-2)]">{it.a}</p>
              <Link to={it.to} className="mt-2 inline-block text-sm font-semibold text-[var(--accent-hover)] underline">{tr('Xem bài chính thức', 'Official article')}</Link>
            </details>
          ))}
        </section>
      ))}
    </div>
  )
}
