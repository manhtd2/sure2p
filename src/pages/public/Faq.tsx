import { Link } from 'react-router-dom'
import { useLang } from '@/i18n'

interface Item {
  q: string
  a: string
  qEn: string
  aEn: string
  to: string
}

const FAQ: Array<{ group: string; groupEn: string; items: Item[] }> = [
  { group: 'Tài khoản và ví', groupEn: 'Account and wallet', items: [
    { q: 'Tôi đăng nhập thế nào?', a: 'Bằng số điện thoại và mã xác thực, rồi ký một thử thách để chứng minh ví. Chỉ kết nối ví thì chưa đủ.', qEn: 'How do I sign in?', aEn: 'With your phone number and a one-time code, then a signed challenge that proves your wallet. Connecting a wallet alone is not enough.', to: '/docs/getting-started/account-wallet' },
    { q: 'Tôi đổi được ví nhận tiền không?', a: 'Không, với giao dịch đã ký. Ví nhận tiền được cố định trong thỏa thuận.', qEn: 'Can I change my payout wallet?', aEn: 'Not for a signed deal. The payout wallet is fixed in the agreement.', to: '/docs/getting-started/account-wallet' },
    { q: 'Tôi mất khóa ví thì sao?', a: 'sure2p không khôi phục được ví hay đổi ví nhận tiền. Không bao giờ gửi cụm từ khôi phục cho ai.', qEn: 'What if I lose my wallet key?', aEn: 'sure2p cannot recover the wallet or change the payout wallet. Never send your recovery phrase to anyone.', to: '/risk-disclosure' },
    { q: 'Ví báo "account has not been authorized". Làm sao?', a: 'Ví chưa cho trang này dùng tài khoản đang chọn. Kết nối trang với đúng tài khoản trong ví, ngắt kết nối rồi kết nối lại.', qEn: 'My wallet says "account has not been authorized". What now?', aEn: 'The wallet has not let this site use the selected account. Connect the site to the right account in the wallet, then disconnect and reconnect.', to: '/docs/faq-troubleshooting' },
  ] },
  { group: 'Nạp tiền và cọc', groupEn: 'Funding and deposits', items: [
    { q: 'Tôi phải nạp bao nhiêu?', a: 'Người mua nạp giá cộng cọc 25%, người bán nạp cọc 25%. Cọc làm tròn lên. Giá 100 thì người mua 125, người bán 25.', qEn: 'How much do I fund?', aEn: 'The buyer funds the price plus a 25% deposit, the seller funds a 25% deposit. Deposits round up. Price 100 means buyer 125, seller 25.', to: '/docs/trading/how-escrow-works' },
    { q: 'Nếu bên kia không nạp?', a: 'Sau 24 giờ ai cũng gọi được lệnh hết hạn; mọi khoản đã nạp trở thành số chờ nhận về ví gốc, không phạt.', qEn: 'What if the other side does not fund?', aEn: 'After 24 hours anyone can call expire; every funded amount becomes claimable by its original wallet, with no penalty.', to: '/docs/trading/funding' },
  ] },
  { group: 'Giao hàng', groupEn: 'Delivery', items: [
    { q: 'sure2p có giao hay giữ hàng không?', a: 'Không. Hàng được trao đổi ngoài ứng dụng; sure2p không truyền, lưu hay xác minh hàng.', qEn: 'Does sure2p deliver or hold the goods?', aEn: 'No. Goods are exchanged outside the app; sure2p does not transmit, store or verify them.', to: '/docs/trading/handover-acceptance' },
    { q: 'Tuyên bố bàn giao của người bán có đủ không?', a: 'Không. Chỉ xác nhận và chấp thuận của người mua mới đưa giao dịch tới chốt.', qEn: "Is the seller's handover declaration enough?", aEn: "No. Only the buyer's confirmation and acceptance bring the deal to completion.", to: '/docs/trading/handover-acceptance' },
  ] },
  { group: 'Chốt và nhận tiền', groupEn: 'Completion and claiming', items: [
    { q: 'Người bán nhận bao nhiêu nếu xong sớm?', a: 'Đủ 100% giá, cộng cọc của mình. Không chia theo thời gian.', qEn: 'How much does the seller get if it finishes early?', aEn: 'The full 100% of the price plus their own deposit. It is not split by time.', to: '/docs/trading/settlement-claims' },
    { q: 'Vì sao tiền chưa vào ví dù đã chốt?', a: 'Chốt chỉ ghi có. Mỗi ví phải tự bấm nhận bằng một giao dịch riêng.', qEn: 'Why is the money not in my wallet after completion?', aEn: 'Completion only credits. Each wallet must claim with its own transaction.', to: '/docs/trading/settlement-claims' },
  ] },
  { group: 'Tranh chấp và kháng nghị', groupEn: 'Disputes and appeals', items: [
    { q: 'Quá hạn thì tiền đi đâu?', a: 'Bị khóa. Không có giải ngân tự động vì im lặng hay hết giờ.', qEn: 'Where does the money go when a deal is overdue?', aEn: 'It is locked. Nothing is released automatically because of silence or a timeout.', to: '/docs/disputes/overdue' },
    { q: 'Tôi kháng nghị được mấy lần?', a: 'Một vòng chung trong 72 giờ sau phán quyết sơ bộ. Phán quyết kháng nghị là chung cuộc.', qEn: 'How many times can I appeal?', aEn: 'One shared round within 72 hours of the preliminary ruling. The appeal ruling is final.', to: '/docs/disputes/rulings-appeals' },
    { q: 'Hai bên tự thỏa thuận được không?', a: 'Được, trước phán quyết cuối: hoàn đủ hai cọc, không phạt, cần chữ ký của cả hai.', qEn: 'Can the two sides settle by themselves?', aEn: 'Yes, before the final ruling: both deposits come back in full, no penalty, and both must sign.', to: '/docs/trading/mutual-settlement' },
  ] },
  { group: 'Riêng tư', groupEn: 'Privacy', items: [
    { q: 'Ai xem được bằng chứng của tôi?', a: 'Chỉ hai bên và người phán quyết hoặc người xem xét được giao. Không công khai. Tệp được mã hóa và tải bằng liên kết hết hạn sau 300 giây.', qEn: 'Who can see my evidence?', aEn: 'Only the two sides and the assigned arbiter or reviewer. Never public. Files are encrypted and downloaded through links that expire after 300 seconds.', to: '/evidence-policy' },
    { q: 'Dữ liệu của tôi nằm ở đâu?', a: 'Dữ liệu riêng tư ở cơ sở dữ liệu máy chủ; chỉ mã băm và dữ liệu giao dịch nằm trên chuỗi công khai.', qEn: 'Where is my data stored?', aEn: 'Private data is in the server database; only hashes and deal data are on the public chain.', to: '/privacy' },
  ] },
  { group: 'Trợ lý và thông báo', groupEn: 'Assistant and notifications', items: [
    { q: 'sure2p có trợ lý AI không?', a: 'Có, ở trang Trợ lý. Nó đọc giao dịch của bạn và soạn bản xem trước hết hạn sau 300 giây; nó không ký, không gửi và không phán quyết. Trò chuyện bằng mô hình chỉ bật khi bản triển khai có khóa nhà cung cấp.', qEn: 'Does sure2p have an AI assistant?', aEn: 'Yes, on the Assistant page. It reads your deals and prepares previews that expire after 300 seconds; it does not sign, send or rule. Model chat is on only when the deployment has a provider key.', to: '/docs/ai-copilot' },
    { q: 'Thông báo gửi qua đâu?', a: 'Trong ứng dụng (chuông và hộp thư), tính từ trạng thái thật mỗi lần bạn mở. Chưa gửi qua thư điện tử hay tin nhắn.', qEn: 'Where do notifications arrive?', aEn: 'In the app (the bell and the inbox), computed from live state each time you open them. Not sent by email or message yet.', to: '/docs/technical/architecture' },
  ] },
]

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
