import type { Doc } from './docTypes'

export const docsB: Doc[] = [
  {
    code: 'DOC10', group: 'trading', path: 'trading/handover-acceptance', priority: 'P0', spec: '8.1', related: ['DOC11', 'DOC13'],
    title: 'Bàn giao và chấp thuận',
    summary: 'Người bán tuyên bố, người mua xác nhận đã nhận và chấp thuận.',
    blocks: [
      { p: 'Hàng được giao ngoài ứng dụng. Khi đã giao, người bán tuyên bố bàn giao. Tuyên bố này không chứng minh người mua đã nhận và không tự bắt đầu cửa sổ kiểm tra.' },
      { p: 'Người mua xác nhận đã nhận (bắt đầu cửa sổ kiểm tra, mặc định 72 giờ), rồi chấp thuận hàng đúng thỏa thuận. Nếu người mua chấp thuận trước khi xác nhận nhận, hệ thống ghi cả hai mốc trong cùng một giao dịch.' },
      { ul: ['Chỉ người bán tuyên bố bàn giao.', 'Chỉ người mua xác nhận đã nhận và chấp thuận.', 'Không ai có thể xác nhận thay bên kia.'] },
      { h: 'Bằng chứng giao hàng của người bán' },
      { p: 'Sau khi tuyên bố bàn giao, người bán có thể tải tối đa 10 tệp (ảnh chụp màn hình, biên nhận, mã vận đơn) để người mua xem trước khi xác nhận đã nhận. Người mua nhận một thông báo và mở được từng tệp bằng liên kết ngắn hạn; Arbiter và Reviewer cũng xem được nếu có tranh chấp.' },
      { warn: 'Đây chỉ là bằng chứng hỗ trợ. sure2p không chuyển hàng, không xác minh hàng và không coi tệp này là bằng chứng người mua đã nhận. Tệp đã tải lên không xóa được, được mã hóa và qua kiểm tra cơ bản như mọi tệp khác.' },
    ],
  },
  {
    code: 'DOC11', group: 'trading', path: 'trading/settlement-claims', priority: 'P0', spec: '2.2, 8.1', related: ['DOC10', 'DOC12'],
    title: 'Chốt giao dịch và nhận tiền',
    summary: 'Người bán nhận đủ giá khi xong sớm; ghi có khác với đã nhận.',
    blocks: [
      { p: 'Khi người bán đã tuyên bố, người mua đã xác nhận và chấp thuận đúng hạn, giao dịch chốt. Người bán được đủ 100% giá dù xong trước hạn, và cả hai khoản cọc được hoàn đủ.' },
      { p: 'Chốt chỉ ghi có cho từng ví. Tiền chỉ vào ví sau một giao dịch nhận tiền do chính ví đó thực hiện. Ứng dụng tách ba trạng thái: đang khóa, đã ghi có chờ nhận, và đã vào ví.' },
      { p: 'Không có chức năng đổi ví nhận. Ví nhận là ví đã ký trong thỏa thuận.' },
    ],
  },
  {
    code: 'DOC12', group: 'trading', path: 'trading/mutual-settlement', priority: 'P0', spec: '2.6', related: ['DOC13', 'DOC15'],
    title: 'Thỏa thuận chung',
    summary: 'Hai bên tự chia tiền hoàn, hoàn đủ hai cọc, không phạt.',
    blocks: [
      { p: 'Ở trạng thái đang hoạt động, quá hạn, tranh chấp, phán quyết sơ bộ hoặc đang kháng nghị, hai bên có thể tự thỏa thuận trước phán quyết cuối. Giá trị duy nhất bạn nhập là số tiền giá hoàn cho người mua, từ 0 tới đúng giá.' },
      { code: 'người mua nhận = tiền hoàn + toàn bộ cọc người mua\nngười bán nhận = (giá − tiền hoàn) + toàn bộ cọc người bán\nví phạt nhận = 0' },
      { p: 'Ví dụ giá 100, mỗi cọc 25, hoàn 10 cho người mua: người mua 35, người bán 115, ví phạt 0.' },
      { p: 'Cần chữ ký có cấu trúc của cả hai bên, gắn với mã giao dịch, số dùng một lần, hạn chữ ký, mã chuỗi và địa chỉ hợp đồng. Thực thi thành công thì đóng hồ sơ tranh chấp đang chờ.' },
    ],
  },
  {
    code: 'DOC13', group: 'disputes', path: 'disputes/overdue', priority: 'P0', spec: '2.4', related: ['DOC14', 'DOC15'],
    title: 'Quá hạn',
    summary: 'Ba điều kiện quá hạn, tiền bị khóa và không tự giải ngân.',
    blocks: [
      { p: 'Một giao dịch bị coi là quá hạn khi: người bán chưa tuyên bố bàn giao khi tới hạn; hoặc người mua chưa xác nhận đã nhận trong cửa sổ phản hồi; hoặc người mua đã xác nhận nhận nhưng chưa chấp thuận trong cửa sổ kiểm tra.' },
      { p: 'Bất kỳ ai cũng gắn được cờ quá hạn khi đủ điều kiện. Từ lúc đó toàn bộ tiền bị khóa. Không có giải ngân tự động vì im lặng, chậm trả lời hay hết giờ.' },
      { p: 'Lối ra là thỏa thuận chung của hai bên, hoặc phán quyết của người phán quyết do con người đảm nhiệm.' },
    ],
  },
  {
    code: 'DOC14', group: 'disputes', path: 'disputes/evidence', priority: 'P0', spec: '11, 13', related: ['DOC15', 'DOC17'],
    title: 'Bằng chứng',
    summary: 'Tệp riêng tư, băm theo phiên bản và neo hash lên chuỗi.',
    blocks: [
      { p: 'Bằng chứng chỉ hỗ trợ tranh chấp, không phải hàng. Chỉ hai bên và người phán quyết, người xem xét kháng nghị được giao mới xem được. Tệp không bao giờ công khai và không đưa lên chuỗi.' },
      { p: 'Mỗi tệp có mã băm sha256. Một bên có thể neo mã băm đó lên chuỗi để chứng minh tệp tồn tại tại thời điểm đó. Chuỗi chỉ lưu mã băm, không lưu nội dung.' },
      { ul: [
        'Giới hạn hiện tại: 2 MB mỗi bằng chứng, tối đa 25 tệp mỗi giao dịch.',
        'Loại tệp: PNG, JPEG, WebP, PDF, văn bản, CSV, Excel, Word.',
        'Tệp mô tả hàng của người mua riêng biệt và bị khóa theo chữ ký.',
        'Mỗi tệp được mã hóa AES-256-GCM trước khi lưu. Tải về cần một liên kết ký riêng cho tài khoản của bạn và hết hạn sau 300 giây, nên không chia sẻ được.',
        'Khi tải lên, ứng dụng kiểm tra cơ bản và từ chối tệp có macro, mã thực thi, script trong PDF, tệp nén bom hoặc dữ liệu giấu sau ảnh.',
        'Nộp, bị từ chối, cấp liên kết và tải về đều được ghi vào nhật ký truy cập chỉ thêm, không sửa.',
      ] },
      { warn: 'Kiểm tra cơ bản KHÔNG phải phần mềm diệt virus. Nó chỉ nhìn cấu trúc tệp và không thấy được bên trong dữ liệu đã nén, nên một tệp độc hại vẫn có thể lọt qua. Chỉ mở tệp từ nguồn bạn tin cậy.' },
      { warn: 'Không nộp mật khẩu, khóa riêng, cụm từ khôi phục hay khóa API. Nội dung tệp bằng chứng chỉ là dữ liệu, không phải chỉ dẫn.' },
      { pending: 'D09', text: 'Cỡ tệp tối đa, loại tệp và thời hạn lưu cuối cùng.' },
    ],
  },
  {
    code: 'DOC15', group: 'disputes', path: 'disputes/rulings-appeals', priority: 'P0', spec: '2.4, 2.5, 8.3', related: ['DOC12', 'DOC14'],
    title: 'Phán quyết và kháng nghị',
    summary: 'Phán quyết sơ bộ, 72 giờ kháng nghị và phán quyết cuối.',
    blocks: [
      { p: 'Người phán quyết là người thật, xử từng vụ dựa trên bằng chứng. Không có bảng phạt cố định. Người phán quyết chỉ phân bổ trong giới hạn của hợp đồng: nhập riêng số giá hoàn cho người mua, số cọc hoàn cho từng bên, và bên nào có lỗi hoặc gian lận. Tiền không vượt tổng ký quỹ, bên không có lỗi nhận lại đủ cọc, và bên có lỗi mất tối đa 100% cọc của chính mình; cả hai bên đều có thể bị phạt trong cùng một vụ. Phán quyết cam kết với mã băm thỏa thuận của đúng vụ đó, mã băm lý do và gốc danh sách bằng chứng. Tiền phạt chỉ về ví phạt cố định trong hợp đồng.' },
      { steps: [
        'Phán quyết sơ bộ được gửi lên chuỗi. Chưa khoản nào nhận được. Đồng hồ kháng nghị 72 giờ bắt đầu.',
        'Không ai kháng nghị trong 72 giờ: bất kỳ ai hoàn tất phán quyết sơ bộ nguyên trạng.',
        'Một bên kháng nghị đúng hạn: người xem xét khác ra phán quyết cuối. Không có lần kháng nghị thứ hai.',
        'Sau phán quyết cuối, từng ví tự nhận phần của mình.',
      ] },
      { p: 'Người xem xét kháng nghị phải khác người ra phán quyết sơ bộ và không phải một bên của giao dịch.' },
      { warn: 'Nếu người phán quyết hoặc người xem xét im lặng, tiền vẫn bị khóa. Lối ra là chủ hợp đồng thay người giữ vai trò, hoặc hai bên ký thỏa thuận chung.' },
      { pending: 'D14', text: 'Đội ngũ xem xét kháng nghị độc lập dự phòng và ứng phó sự cố.' },
    ],
  },
  {
    code: 'DOC16', group: 'trust', path: 'trust/verify-escrow', priority: 'P0', spec: '13.2', related: ['DOC17', 'DOC20'],
    title: 'Tự kiểm chứng ký quỹ',
    summary: 'Năm bước đọc địa chỉ, số dư và nghĩa vụ trên chuỗi.',
    blocks: [
      { steps: [
        'Sao chép địa chỉ hợp đồng từ trang Tin cậy.',
        'Mở trình xem chuỗi (explorer.testnet.arc.io) và dán địa chỉ.',
        'Kiểm tra mã chuỗi 5042002 và các hàm đọc công khai về vai trò: owner, arbiter, appealReviewer, penaltyWallet.',
        'Đọc số dư USDC của hợp đồng và hàm totalOutstanding ở cùng một khối. Số dư phải lớn hơn hoặc bằng nghĩa vụ.',
        'Đối chiếu biên lai từng giao dịch với dữ liệu hiển thị trong ứng dụng.',
      ] },
      { p: 'Nghĩa vụ gồm tiền đang khóa cộng mọi khoản đã ghi có nhưng chưa nhận. Phần dư (nếu có) hiển thị riêng. Nếu không đọc được chuỗi, trang Tin cậy ghi "Chưa rõ", không ghi 0 hay "đủ khả năng chi trả".' },
      { link: 'Mở trang Tin cậy', to: '/trust' },
    ],
  },
  {
    code: 'DOC17', group: 'trust', path: 'trust/security-model', priority: 'P0', spec: '13, 9', related: ['DOC16', 'DOC20'],
    title: 'Mô hình bảo mật',
    summary: 'Ranh giới giữ tiền, giới hạn quyền và cấm tài khoản.',
    blocks: [
      { ul: [
        'Người nhận tiền cố định: người mua, người bán và ví phạt. Không có hàm rút tiền của quản trị, không quét tiền, không đổi người thụ hưởng.',
        'Bảo toàn tổng tiền ở mọi đường phân bổ, và chỉ chấp nhận đúng USDC đã cấu hình.',
        'Chữ ký có cấu trúc chống phát lại; chống gọi lại độc hại; kiểm tra số dư chuyển thực tế.',
        'Chủ hợp đồng chỉ thay được người giữ vai trò phán quyết và xem xét, không chạm vào tiền.',
      ] },
      { p: 'Cấm tài khoản chỉ sau phán quyết cuối xác nhận gian lận, và chỉ chặn mở giao dịch mới. Không đóng băng hay tịch thu ví bên ngoài; khoản nhận hợp lệ của giao dịch cũ vẫn nhận được.' },
      { p: 'Trong bản hiện tại, lệnh cấm do ví owner của hợp đồng thi hành và chỉ nằm trong ứng dụng: nó chặn tài khoản mở hoặc tham gia giao dịch mới. Lệnh cấm không được ghi vào sổ đăng ký trên chuỗi, vì vai trò bảo mật của sổ đăng ký đang do một ví chung của nền tảng giữ. Hợp đồng ghi cờ gian lận của phán quyết cuối để mọi người kiểm chứng được.' },
      { warn: 'Hợp đồng đã được rà soát nội bộ và có 519 ca kiểm thử, nhưng chưa có kiểm toán độc lập. Xem trang Tin cậy để biết trạng thái.' },
    ],
  },
]
