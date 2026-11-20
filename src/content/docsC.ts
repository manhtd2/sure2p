import type { Doc } from './docTypes'

export const docsC: Doc[] = [
  {
    code: 'DOC18', group: 'product', path: 'ai-copilot', priority: 'P0', spec: '12', related: ['DOC02'],
    title: 'Trợ lý AI (chưa có trong bản này)',
    summary: 'Trợ lý chỉ chuẩn bị, không ký và không phán quyết. Chưa được xây trong bản hiện tại.',
    blocks: [
      { warn: 'Trợ lý AI chưa được xây trong bản hiện tại. Trang này mô tả thiết kế dự kiến, không phải tính năng đang chạy.' },
      { p: 'Thiết kế dự kiến: trợ lý đọc giao dịch bạn có quyền xem và dựng bản xem trước hành động. Nó không kết tội, không phán quyết, không quyết định mức phạt, không cấm tài khoản, không ký và không phát giao dịch. Mọi hành động cần bạn bấm tiếp tục rồi ví của bạn ký.' },
      { p: 'Bằng chứng không được gửi cho mô hình theo mặc định, và nội dung trong tệp bằng chứng không bao giờ được coi là lệnh. Luồng giao dịch thủ công luôn hoạt động khi không có trợ lý.' },
      { pending: 'D04', text: 'Nhà cung cấp mô hình trợ lý chưa được chọn, nên chưa xây.' },
    ],
  },
  {
    code: 'DOC19', group: 'technical', path: 'technical/architecture', priority: 'P1', spec: '10', related: ['DOC20', 'DOC21'],
    title: 'Kiến trúc',
    summary: 'Giao diện, máy chủ, bộ quét sự kiện, hợp đồng và lưu trữ.',
    blocks: [
      { ul: [
        'Giao diện: React, TypeScript, Vite, wagmi và viem.',
        'Máy chủ: các hàm TypeScript kiểm tra dữ liệu bằng lược đồ, phiên đăng nhập và phân quyền theo thành viên.',
        'Cơ sở dữ liệu: Turso (tương thích SQLite) cho bản thử nghiệm.',
        'Hợp đồng: Solidity, Foundry, OpenZeppelin.',
        'Bộ quét sự kiện: đọc nhật ký hợp đồng theo khoảng, có con trỏ bền vững, chống trùng và phát hiện tổ chức lại chuỗi.',
        'Bằng chứng: lưu trong cơ sở dữ liệu ở bản này.',
      ] },
      { p: 'Trình duyệt không bao giờ nhận khóa riêng, mã xác thực thô hay bằng chứng của người khác. Giao dịch tài chính luôn qua bản xem trước, người dùng bấm tiếp tục, ví ký và biên lai thật quay về bộ quét rồi giao diện mới cập nhật.' },
    ],
  },
  {
    code: 'DOC20', group: 'technical', path: 'technical/smart-contracts', priority: 'P1', spec: '9', related: ['DOC16', 'DOC21'],
    title: 'Hợp đồng thông minh',
    summary: 'Hàm, sự kiện, vai trò và kiểm chứng mã nguồn.',
    blocks: [
      { p: 'Hợp đồng ký quỹ và sổ đăng ký tài khoản được liệt kê với địa chỉ thật ở trang Tin cậy. Mã nguồn nằm trong kho mã tại thư mục contracts.' },
      { ul: [
        'Vòng đời: createEscrow, fundBuyer, fundSeller, expireUnfunded, declareHandover, acknowledgeReceipt, confirmBuyerAcceptance, finalizeMutualCompletion.',
        'Quá hạn và tranh chấp: flagOverdue, openDispute, anchorEvidence.',
        'Phán quyết: issuePreliminaryRuling, appeal, finalizeRuling, issueFinalRuling.',
        'Tiền: executeMutualSettlement, claim.',
      ] },
      { p: 'Vai trò: owner (đổi người giữ vai trò), arbiter (phán quyết sơ bộ), appealReviewer (phán quyết cuối) và penaltyWallet (cố định lúc deploy). Sổ đăng ký tài khoản có vai trò bảo mật để chặn ví tạo ký quỹ mới.' },
      { pending: 'D06', text: 'Báo cáo kiểm toán bên thứ ba chưa có. Xem trang Tin cậy.' },
    ],
  },
  {
    code: 'DOC21', group: 'technical', path: 'technical/api-indexer', priority: 'P1', spec: '10, 11', related: ['DOC19'],
    title: 'API và bộ quét',
    summary: 'Phạm vi giao diện lập trình, mã công khai và định danh sự kiện.',
    blocks: [
      { p: 'Mã công khai của giao dịch gồm đúng 12 ký tự hệ 16 viết thường, có ít nhất một chữ cái từ a tới f. Mã số nội bộ của hợp đồng không xuất hiện trong địa chỉ trang hay giao diện lập trình.' },
      { p: 'Truy cập sai quyền hoặc mã công khai không tồn tại đều trả cùng một lỗi không tìm thấy, để không lộ hồ sơ có tồn tại hay không.' },
      { p: 'Bộ quét bắt đầu từ khối triển khai, đọc nhật ký theo khoảng 10.000 khối, chống trùng theo bộ ba mã chuỗi, mã giao dịch, vị trí nhật ký, và phát lại an toàn khi chuỗi tổ chức lại. Nó cũng đối chiếu số USDC của hợp đồng với tổng nghĩa vụ theo chu kỳ.' },
      { p: 'Các đầu công khai không cần đăng nhập: /api/health, /api/trust và /api/status. Mọi đầu còn lại cần phiên đăng nhập.' },
    ],
  },
  {
    code: 'DOC22', group: 'resources', path: 'faq-troubleshooting', priority: 'P0', spec: '16', related: ['DOC03', 'DOC09'],
    title: 'Hỏi đáp và xử lý sự cố',
    summary: 'Lỗi ví, giao dịch đang chờ, mã xác thực và bằng chứng.',
    blocks: [
      { h: 'Ví báo sai mạng' },
      { p: 'Chuyển ví sang Arc Testnet (mã chuỗi 5042002). Ứng dụng chặn hành động cho tới khi đúng mạng.' },
      { h: 'Giao dịch thành công nhưng ứng dụng chưa cập nhật' },
      { p: 'Bộ quét có thể chậm vài khối. Ứng dụng hiện Đang chờ quét kèm liên kết giao dịch. Đợi vài giây rồi tải lại; thử lại không tạo giao dịch trùng.' },
      { h: 'Ví từ chối ký hoặc giao dịch bị hoàn' },
      { p: 'Ứng dụng không ghi thành công giả. Kiểm tra số dư USDC cho phí mạng và số đã cho phép chuyển, rồi thử lại.' },
      { h: 'Mã xác thực không tới' },
      { p: 'Bản thử nghiệm dùng mã giả hiện ngay trên màn hình, có nhãn rõ. Nếu hết hạn hoặc nhập sai quá số lần, xin mã mới.' },
      { h: 'Tải bằng chứng bị từ chối' },
      { p: 'Kiểm tra loại tệp (phải đúng nội dung thật, không chỉ đúng đuôi) và cỡ tối đa 2 MB. Chỉ hai bên và quản trị được giao xem được tệp.' },
      { link: 'Liên hệ hỗ trợ', to: '/contact' },
    ],
  },
]
