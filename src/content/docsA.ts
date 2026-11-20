import type { Doc } from './docTypes'

export const docsA: Doc[] = [
  {
    code: 'DOC01', group: 'start', path: '', priority: 'P0', spec: '1, 2', related: ['DOC02', 'DOC08', 'DOC16'],
    title: 'sure2p là gì',
    summary: 'sure2p giữ tiền ký quỹ cho giao dịch giữa người mua và người bán trên mạng thử nghiệm Arc, bằng USDC.',
    blocks: [
      { p: 'sure2p là ứng dụng ký quỹ cho giao dịch hai bên. Người mua khóa giá hàng cộng khoản cọc 25%, người bán khóa khoản cọc 25% của mình. Khi hai bên xác nhận xong, người bán nhận đủ giá và cả hai nhận lại cọc.' },
      { p: 'Hàng hóa hoặc dịch vụ được trao đổi hoàn toàn ngoài ứng dụng (thư điện tử, ứng dụng nhắn tin, trang web). sure2p không truyền, không lưu, không mở khóa và không kiểm chứng hàng. Thứ bạn nộp vào ứng dụng chỉ là bằng chứng hỗ trợ khi có tranh chấp.' },
      { h: 'Thuật ngữ' },
      { ul: [
        'Giá: số USDC người mua trả cho hàng.',
        'Cọc: 25% giá, làm tròn lên, mỗi bên tự khóa phần của mình.',
        'Đang khóa: tiền nằm trong hợp đồng, chưa thuộc về ai.',
        'Chờ nhận: tiền đã được ghi có cho một ví, ví đó phải tự nhận.',
        'Đã nhận: tiền đã vào ví sau giao dịch nhận tiền thành công.',
      ] },
      { warn: 'Bản này chỉ chạy trên mạng thử nghiệm Arc. USDC thử nghiệm không có giá trị thật và chưa có kiểm toán độc lập.' },
    ],
  },
  {
    code: 'DOC02', group: 'start', path: 'getting-started/quick-start', priority: 'P0', spec: '8.1', related: ['DOC05', 'DOC09', 'DOC11'],
    title: 'Bắt đầu nhanh: tám bước',
    summary: 'Từ đăng nhập tới nhận tiền trong tám bước.',
    blocks: [
      { steps: [
        'Đăng nhập bằng số điện thoại và mã xác thực, rồi liên kết ví đúng mạng bằng một chữ ký.',
        'Một bên tạo bản nháp và gửi lời mời (liên kết, mã hoặc mã quét, hết hạn sau 24 giờ).',
        'Bên còn lại nhận lời mời, chấp thuận hoặc đề xuất sửa. Mỗi lần sửa tạo phiên bản mới.',
        'Cả hai ví ký cùng một phiên bản thỏa thuận, rồi một bên tạo ký quỹ trên chuỗi.',
        'Người mua nạp giá cộng cọc, người bán nạp cọc. Chỉ khi đủ cả hai bên giao dịch mới hoạt động.',
        'Người bán giao hàng ngoài ứng dụng và tuyên bố bàn giao.',
        'Người mua xác nhận đã nhận và chấp thuận hàng đúng thỏa thuận.',
        'Người bán nhận đủ giá và cọc, người mua nhận lại cọc. Mỗi ví tự nhận phần của mình.',
      ] },
      { link: 'Xem ví dụ với số tiền của bạn', to: '/how-it-works' },
    ],
  },
  {
    code: 'DOC03', group: 'start', path: 'getting-started/network', priority: 'P0', spec: '2.1', related: ['DOC04', 'DOC22'],
    title: 'Mạng thử nghiệm Arc',
    summary: 'Cấu hình mạng, USDC thử nghiệm và phí mạng.',
    blocks: [
      { ul: [
        'Mạng: Arc Testnet, mã chuỗi 5042002.',
        'RPC: https://rpc.testnet.arc.io',
        'Trình xem chuỗi: https://explorer.testnet.arc.io',
        'USDC: 0x3600000000000000000000000000000000000000, 6 chữ số thập phân khi dùng như token.',
      ] },
      { p: 'Trên Arc, USDC cũng là đồng trả phí mạng. Phí mạng dùng 18 chữ số thập phân của cùng một USDC, nên số dư của bạn chỉ là một số duy nhất. Đừng cộng "số dư gốc" với "số dư token" thành hai khoản.' },
      { p: 'Lấy USDC thử nghiệm từ vòi tiền của Circle (faucet.circle.com). Khi ví hỏi chuyển mạng, chọn Arc Testnet.' },
      { warn: 'Nếu ví đang ở mạng khác, ứng dụng chặn mọi hành động và yêu cầu chuyển đúng mạng.' },
    ],
  },
  {
    code: 'DOC04', group: 'start', path: 'getting-started/account-wallet', priority: 'P0', spec: '2.8', related: ['DOC03', 'DOC07'],
    title: 'Tài khoản và ví',
    summary: 'Điện thoại, mã xác thực, chứng minh ví và việc mất khóa.',
    blocks: [
      { p: 'Một số điện thoại chỉ có một tài khoản. Đăng nhập gồm ba lớp: số điện thoại, mã xác thực một lần, rồi chữ ký chứng minh bạn sở hữu ví trên đúng mạng. Chỉ kết nối ví thôi thì chưa được coi là đã đăng nhập.' },
      { p: 'Ví nhận tiền được cố định trong thỏa thuận đã ký. Không có chức năng đổi ví nhận tiền của một giao dịch đã ký, và mã xác thực không phải cách khôi phục ví.' },
      { warn: 'Bản thử nghiệm hiện dùng mã xác thực giả có gắn nhãn rõ. Nó không phải xác minh số điện thoại thật.' },
      { warn: 'Nếu bạn mất khóa ví, sure2p không thể khôi phục hay đổi ví nhận tiền. Không bao giờ gửi cụm từ khôi phục hay khóa riêng cho ai, kể cả sure2p.' },
      { pending: 'D11', text: 'Thiết kế khôi phục tài khoản trong tương lai chưa được chốt.' },
    ],
  },
  {
    code: 'DOC05', group: 'trading', path: 'trading/create-deal', priority: 'P0', spec: '7.1', related: ['DOC06', 'DOC08'],
    title: 'Tạo giao dịch',
    summary: 'Các trường của bản nháp, vai trò và tiêu chí chấp nhận.',
    blocks: [
      { p: 'Bạn chọn vai trò của mình (người mua hoặc người bán). Người tạo không tự động là người mua hay người bán. Bản nháp chỉ nằm ở máy chủ, chưa có gì trên chuỗi và chưa xin chữ ký.' },
      { ul: [
        'Tiêu đề, mô tả và số lượng.',
        'Tiêu chí chấp nhận: mô tả thế nào là giao đạt yêu cầu. Đây là căn cứ khi có tranh chấp.',
        'Giá USDC: lớn hơn 0, tối đa 6 chữ số thập phân. Ứng dụng hiện số cọc đã làm tròn trước khi ký.',
        'Hạn bàn giao: phải nằm sau cửa sổ nạp tiền 24 giờ.',
        'Cửa sổ phản hồi của người mua và cửa sổ kiểm tra, mặc định 72 giờ.',
        'Người mua có thể đính kèm tệp mô tả hàng (Excel, Word, PDF, văn bản, CSV, ảnh). Tệp bị khóa theo chữ ký khi hai bên chốt.',
      ] },
      { warn: 'Không ghi mật khẩu, khóa riêng hay cụm từ khôi phục vào mô tả.' },
    ],
  },
  {
    code: 'DOC06', group: 'trading', path: 'trading/invites-negotiation', priority: 'P0', spec: '2.8', related: ['DOC05', 'DOC07'],
    title: 'Lời mời và thương lượng',
    summary: 'Liên kết, mã, mã quét, hạn 24 giờ và phiên bản thỏa thuận.',
    blocks: [
      { p: 'Liên kết, mã ngắn và mã quét là cùng một lời mời. Lời mời hết hạn sau 24 giờ, chỉ một tài khoản nhận được, và bạn thu hồi được trước khi có người nhận. Phần bí mật của liên kết nằm sau dấu thăng nên không đi qua máy chủ hay nhật ký.' },
      { p: 'Người nhận thấy toàn bộ thỏa thuận và nghĩa vụ cọc, rồi chọn chấp thuận, đề xuất sửa hoặc từ chối. Mỗi lần sửa tạo một phiên bản mới không sửa được và làm mất hiệu lực mọi chấp thuận cũ.' },
      { warn: 'Lời mời không phải là đã đồng ý. Chỉ chữ ký của cả hai ví trên cùng một phiên bản mới có giá trị.' },
    ],
  },
  {
    code: 'DOC07', group: 'trading', path: 'trading/agreements', priority: 'P0', spec: '2.8, 13.3', related: ['DOC06', 'DOC09'],
    title: 'Ký thỏa thuận',
    summary: 'Chữ ký có cấu trúc, mã băm thỏa thuận và phiên bản chính sách.',
    blocks: [
      { p: 'Hai ví ký cùng một thỏa thuận có cấu trúc (EIP-712). Chữ ký gắn với mã chuỗi, địa chỉ hợp đồng, số dùng một lần, mã băm thỏa thuận và mã băm chính sách. Chữ ký không dùng lại được cho thỏa thuận khác.' },
      { p: 'Mã băm thỏa thuận bao gồm điều khoản và mã băm của các tệp mô tả đính kèm, nên đổi một chữ hay một tệp sau khi ký đều làm chữ ký mất hiệu lực.' },
      { p: 'Trước khi ký bạn phải đọc và xác nhận văn bản rủi ro. Ô xác nhận chỉ ghi nhận đồng ý, chưa phải chữ ký.' },
      { link: 'Đọc cảnh báo rủi ro', to: '/risk-disclosure' },
    ],
  },
  {
    code: 'DOC08', group: 'trading', path: 'trading/how-escrow-works', priority: 'P0', spec: '2.2', related: ['DOC09', 'DOC11'],
    title: 'Ký quỹ 150% hoạt động thế nào',
    summary: 'Giá, hai khoản cọc 25% làm tròn lên, tổng giữ 150%.',
    blocks: [
      { code: 'cọc mỗi bên = ceil(giá / 4)\nngười mua nạp = giá + cọc\nngười bán nạp = cọc\ntổng giữ = giá + 2 × cọc' },
      { ul: ['Giá 100 USDC: người mua 125, người bán 25, tổng 150.', 'Giá 200 USDC: người mua 250, người bán 50, tổng 300.'] },
      { p: 'Mọi phép tính dùng số nguyên theo đơn vị nhỏ nhất của USDC, không dùng số thực. Với giá rất nhỏ, làm tròn lên khiến tỉ lệ cọc thực tế lớn hơn 25% một chút; ứng dụng hiện số đã làm tròn trước khi hai bên ký.' },
      { p: 'Tiến độ hiển thị chỉ phản ánh thời gian giữa lúc kích hoạt và hạn bàn giao. Nó không phải tiền trả dần: trước khi hoàn tất, người bán rút được 0.' },
    ],
  },
  {
    code: 'DOC09', group: 'trading', path: 'trading/funding', priority: 'P0', spec: '2.2, 8.2', related: ['DOC08', 'DOC10'],
    title: 'Nạp tiền',
    summary: 'Cho phép chuyển tiền, nạp, hạn 24 giờ và hoàn không phạt.',
    blocks: [
      { p: 'Mỗi bên nạp bằng ví của mình đúng số tuyệt đối: người mua nạp giá cộng cọc, người bán nạp cọc. Bạn cần cho phép hợp đồng chuyển đúng số USDC đó trước, rồi mới nạp. Nạp trùng, nạp sai số hoặc nạp sau hạn đều bị từ chối.' },
      { p: 'Giao dịch chỉ hoạt động khi đủ cả hai bên trên chuỗi. Hạn nạp là 24 giờ kể từ lúc tạo ký quỹ trên chuỗi, không phải lúc lưu bản nháp.' },
      { p: 'Hết 24 giờ mà chưa đủ, bất kỳ ai gọi được lệnh hết hạn. Mỗi khoản đã nạp trở thành số chờ nhận về đúng ví gốc, không phạt. Ví đó tự nhận lại, kể cả khi tài khoản đã bị hạn chế mở giao dịch mới.' },
    ],
  },
]
