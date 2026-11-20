import { useLang } from '@/i18n'

interface Entry {
  date: string
  area: string
  kind: 'Thêm mới' | 'Thay đổi' | 'Sửa lỗi'
  title: string
  impact: string
  /** released = confirmed live; repo = in the source repository, live deployment not confirmed. */
  state: 'released' | 'repo'
}

const ENTRIES: Entry[] = [
  { date: '2026-11-20', area: 'Quản trị', kind: 'Thay đổi', title: 'Console quản trị tách thành Tổng quan, Hồ sơ, Kháng cáo, Ký quỹ, Tài khoản, Nhật ký và Cài đặt; luồng cấm tài khoản cho quản trị bảo mật', impact: 'Chỉ ví giữ vai trò trên chuỗi mới vào được. Cấm chỉ chặn giao dịch mới và cần phán quyết cuối xác nhận gian lận.', state: 'repo' },
  { date: '2026-11-20', area: 'Giao dịch', kind: 'Sửa lỗi', title: 'Trang bản nháp kích hoạt bộ quét sau khi tạo ký quỹ, để mã công khai hiện ra trên Vercel', impact: 'Trước đó mã công khai có thể chậm hiện cho tới khi mở trang giao dịch.', state: 'repo' },
  { date: '2026-11-20', area: 'Tài khoản', kind: 'Sửa lỗi', title: 'Tạo lời mời hoạt động trên Vercel (trước đó trả 404); thêm trang Tài khoản', impact: 'Đường tạo lời mời nay dùng cùng dạng ?action= như các đường khác.', state: 'repo' },
  { date: '2026-11-20', area: 'Hợp đồng', kind: 'Thay đổi', title: 'Hợp đồng ký quỹ bản 3: phán quyết theo từng bên (hoàn cọc riêng, cờ lỗi và gian lận cho mỗi bên), gắn với mã băm thỏa thuận và gốc bằng chứng', impact: 'Địa chỉ mới ở trang Tin cậy. Bản 2 không có giao dịch nào nên không có gì bị kẹt.', state: 'released' },
  { date: '2026-11-20', area: 'Công khai', kind: 'Thêm mới', title: 'Trang Tin cậy, Trạng thái, tài liệu, chính sách, hỏi đáp và liên hệ', impact: 'Mọi số liệu trên chuỗi đọc trực tiếp; không đọc được thì ghi Chưa rõ.', state: 'repo' },
  { date: '2026-11-19', area: 'Giao dịch', kind: 'Thêm mới', title: 'Người mua đính kèm tệp mô tả hàng, khóa theo chữ ký', impact: 'Mã băm tệp nằm trong thỏa thuận hai bên ký.', state: 'repo' },
  { date: '2026-11-19', area: 'Giao dịch', kind: 'Thêm mới', title: 'Xóa bản nháp chưa có đối tác; claim tiền phạt cho ví phạt', impact: 'Người tạo xóa được bản nháp khi chưa ai tham gia.', state: 'repo' },
  { date: '2026-11-16', area: 'Hợp đồng', kind: 'Thêm mới', title: 'Hợp đồng ký quỹ bản 2 trên Arc Testnet: phán quyết, kháng nghị 72 giờ, phạt, neo mã băm bằng chứng', impact: 'Địa chỉ ở trang Tin cậy. Giao dịch trên bản 1 không còn hiện trong ứng dụng.', state: 'released' },
  { date: '2026-11-16', area: 'Quản trị', kind: 'Thêm mới', title: 'Trang /admin cho người phán quyết và người xem xét kháng nghị; tải bằng chứng', impact: 'Chỉ ví giữ vai trò trên chuỗi mới vào được.', state: 'repo' },
]

export default function Changelog() {
  const { tr } = useLang()
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="display text-3xl font-bold">{tr('Nhật ký thay đổi', 'Changelog')}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {tr('Chỉ ghi thay đổi có thật. "Trong mã nguồn" nghĩa là đã có trong kho mã nhưng chưa xác nhận đã triển khai trên trang đang chạy.', 'Only real changes are listed. "In repository" means the change is in the source repository but its live deployment is not confirmed.')}
        </p>
      </header>
      <ul className="space-y-3">
        {ENTRIES.map((e) => (
          <li key={e.title} className="card p-4">
            <p className="mono text-xs text-[var(--subtle)]">{e.date} · {e.area} · {e.kind}</p>
            <p className="font-semibold">{e.title}</p>
            <p className="text-sm text-[var(--ink-2)]">{e.impact}</p>
            <span className="chip mt-2">{e.state === 'released' ? tr('Đã phát hành', 'Released') : tr('Trong mã nguồn', 'In repository')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
