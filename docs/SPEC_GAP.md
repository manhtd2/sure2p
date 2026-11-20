# sure2p: đối chiếu đặc tả 10 phần với bản đang chạy

Ngày: 2026-11-20. Đối chiếu dựa trên mã nguồn và hợp đồng đang có trong kho, không dựa trên trí nhớ. Cập nhật 2026-11-20 (cuối ngày): đã xây 14 trang công khai, 22 bài tài liệu, trang Tin cậy và Trạng thái (số liệu đọc trực tiếp). Hợp đồng V3 và các trang quản trị chưa làm.

Ký hiệu: ĐÃ CÓ (khớp đặc tả), MỘT PHẦN (có nhưng thiếu), CHƯA CÓ, LỆCH (làm khác đặc tả), CHẶN (cần quyết định của chủ dự án).

## 1. Hợp đồng (mục 2, 5, 9)

| Hạng mục | Tình trạng | Ghi chú |
|---|---|---|
| 16 hàm tối thiểu của mục 9 | ĐÃ CÓ | V2 có đủ, đúng tên như mục 9 (`createEscrow`, `fundBuyer`, `fundSeller`, `expireUnfunded`, `declareHandover`, `acknowledgeReceipt`, `confirmBuyerAcceptance`, `finalizeMutualCompletion`, `flagOverdue`, `openDispute`, `executeMutualSettlement`, `appeal`, `claim`; phán quyết dùng tên `issuePreliminaryRuling`, `finalizeRuling`, `issueFinalRuling`) |
| Cọc 25% làm tròn lên, nạp đủ ba khoản mới kích hoạt, hạn nạp 24 giờ, hoàn không phạt | ĐÃ CÓ | 335 test đạt, gồm test bất biến |
| Kháng nghị một vòng chung 72 giờ, người xem xét khác người phán quyết sơ bộ, không phải một bên | ĐÃ CÓ | |
| Thỏa thuận chung ở mọi trạng thái trước phán quyết cuối, phạt 0, hai chữ ký có cấu trúc | ĐÃ CÓ | |
| Phạt: hoàn từng khoản cọc cho từng bên riêng biệt, cờ lỗi và cờ gian lận cho mỗi bên (F16, F18, mục 2.4) | LỆCH, CHẶN | V2 chỉ có một bên có lỗi, một mức phạt (tối đa 100% cọc bên đó). Đặc tả cho phép trừ cọc của cả hai bên trong cùng một vụ. Muốn khớp phải viết hợp đồng mới ở địa chỉ mới |
| Cờ gian lận trong phán quyết | CHƯA CÓ | Không có trên chuỗi. Sổ đăng ký tài khoản đã có `setBanned` cho vai trò bảo mật, nhưng chưa có luồng nào nối phán quyết cuối với việc cấm |
| Owner, Arbiter, Reviewer, ví phạt phải khác nhau (mục 9) | LỆCH | Theo lựa chọn của bạn, ví owner trùng ví phạt (`0xEb8d...7253e`). Ví phạt là `immutable` trong V2 nên không đổi được nếu không deploy lại |
| Chuyển vai trò sang nhiều chữ ký 2 trên 3 (mục 14) | MỘT PHẦN | Không cần đổi code: owner dùng Ownable2Step nên có thể chuyển sang ví Safe. Việc này cần bạn thực hiện |
| Vai trò sổ đăng ký tài khoản còn ở ví deploy chung của nền tảng (mục 3) | CHẶN | Cần ví của bạn thực hiện, tôi không làm thay được |

Quy tắc đặc tả (mục 1.2, 3, 14): không tự deploy hợp đồng mới. Mọi thay đổi ở phần này phải có đồng ý của bạn.

## 2. Trang (mục 6)

Đang có 8 route: `/`, `/sign-in`, `/join`, `/transactions`, `/transactions/new`, `/transactions/:ref`, `/admin` và route mặc định. Không có `/account`, `/assistant`.

| Nhóm | Đặc tả | Đang có | Còn thiếu |
|---|---|---|---|
| Công khai (6.1) | 15 trang | Chỉ `/` | `/how-it-works`, `/trust`, `/security`, `/docs` (22 bài), `/faq`, `/privacy`, `/terms`, `/risk-disclosure`, `/dispute-policy`, `/evidence-policy`, `/fees`, `/contact`, `/status`, `/changelog` |
| Sau đăng nhập (6.2) | 7 trang | 4 (`/sign-in`, `/join`, `/transactions`, `/transactions/new`) cộng chi tiết | `/account`, `/assistant`. Chi tiết giao dịch chưa chia thành 8 thẻ con |
| Quản trị (6.4) | 8 trang | 1 trang `/admin` gộp danh sách, chi tiết, ví phạt | `/admin/escrows`, `/admin/cases` riêng, `/admin/cases/[id]`, màn xem xét kháng nghị riêng, `/admin/accounts`, `/admin/audit`, `/admin/settings` |

Đường dẫn Vercel Hobby (mục 3): trần 12 hàm, hiện đang dùng 11. Trang giao diện là trang tĩnh nên không tốn hàm. Mọi API mới phải gộp vào hàm có sẵn bằng tham số truy vấn.

## 3. Thành phần C01–C22 và biểu mẫu F01–F22

Đã có một phần: thẻ phân bổ tiền, huy hiệu trạng thái, bước giao dịch chuỗi, so sánh phiên bản thỏa thuận, chia sẻ lời mời, dòng thời gian, tải bằng chứng, hộp cảnh báo rủi ro, đếm ngược kháng nghị, thẻ chờ nhận.

Chưa có: C16 bảng chứng minh chuỗi, C17 bảng minh bạch số dư, C18 xem trước hành động của trợ lý, C19 bố cục tài liệu, C21 huy hiệu trạng thái dịch vụ, C22 băng phiên bản chính sách. C13 (xem trước phán quyết) có nhưng chỉ cho mô hình một bên có lỗi.

Biểu mẫu: F01–F13, F17, F19, F20 đã có ở mức khác nhau về chi tiết. F14 thiếu tham chiếu bằng chứng và bản trình bày. F15 có `SettlementPanel` nhưng chưa chắc đủ bảng phân bổ, trạng thái chữ ký từng bên theo mục 2.6. F16 và F18 thiếu hoàn cọc từng bên, cờ lỗi từng bên, cờ gian lận. F21 (liên hệ) và F22 (xem trước của trợ lý) chưa có. Văn bản đồng ý rủi ro khi ký (13.3) chưa có bản tiếng Anh.

## 4. API (mục 10.3)

Đã có (đường dẫn gộp): `/auth/otp/*`, `/auth/wallet/*`, `/me`, `/drafts*`, `/invitations*`, `/transactions*` gồm `history`, `balances`, `evidence`, `settlements`, `/admin/cases*`.

Chưa có: `POST /actions/prepare`, `GET /actions/:id`, `POST /actions/:id/confirm` (bản xem trước máy chủ 300 giây), `POST /transactions/:id/disputes` (đang mở tranh chấp thẳng bằng ví, không có bản trình bày và tham chiếu bằng chứng), `.../appeals/prepare`, `POST /admin/accounts/:id/ban`, `POST /ai/chat`, đầu `GET` công khai cho Tin cậy và Trạng thái.

## 5. Dữ liệu, bằng chứng, bộ quét (mục 10.2, 11)

- Bộ quét: bắt đầu từ khối triển khai, chống trùng sự kiện, phát hiện reorg bằng băm khối, đối chiếu số dư định kỳ. ĐÃ CÓ.
- Bằng chứng: lưu byte trong database, không mã hóa riêng, không quét mã độc, tải qua phiên đăng nhập thay cho liên kết ký 300 giây. Không có phiên bản danh sách bằng chứng đóng băng. MỘT PHẦN.
- Giới hạn bằng chứng đặc tả: 2 MB, 25 tệp, PNG/JPEG/WebP/PDF/chữ "cho đến khi chốt ở D09". Bản hiện đã nới thêm Excel, Word, CSV, và thêm tệp mô tả hàng của Buyer (5 tệp, 3 MB). Đây là LỆCH so với đặc tả, cần bạn quyết định giữ hay thu lại.
- Tài khoản bị cấm: chưa có trạng thái cấm ở máy chủ theo số điện thoại, chưa có trang quản trị cấm.

## 6. Trợ lý AI (mục 12)

CHƯA CÓ. Cần chọn nhà cung cấp mô hình và khóa API (D04). 12 công cụ chỉ chuẩn bị phụ thuộc vào đầu `actions/prepare` ở mục 4.

## 7. Trang Tin cậy, Trạng thái, tài liệu, chính sách (mục 13, 16)

CHƯA CÓ. Trang Tin cậy cần đọc từ chuỗi: số dư USDC của hợp đồng, tổng nghĩa vụ (`totalOutstanding`), vai trò, ví phạt. Hợp đồng đã có các hàm đọc đó. Trạng thái dịch vụ cần đầu dò thật; chưa có giám sát thì phải ghi "Chưa cấu hình giám sát". 22 bài tài liệu và các chính sách công khai (riêng tư, điều khoản, rủi ro, tranh chấp, bằng chứng) cần nội dung pháp lý do bạn cung cấp (D01, D02, D03, D10): tôi chỉ dựng cấu trúc và để trống có nhãn chờ chốt.

## 8. Kiểm thử (mục 17, 19)

- Hợp đồng: 335 test Foundry đạt, gồm bất biến và fuzz.
- Server: 25 test Vitest đạt.
- Chưa có: kiểm thử đầu cuối bằng trình duyệt, kiểm thử bảo mật theo QA, QA22 (trình đọc màn hình, màn 390 px).
- Mục 19 yêu cầu chạy bốn luồng thật trên mạng thử nghiệm với mã giao dịch từng bước. Chưa chạy luồng nào của V2. Cần ít nhất 2 ví người dùng có USDC thử, cộng ví Arbiter và Reviewer do bạn giữ khóa (tôi không có khóa của hai ví này), nên phần phán quyết và kháng nghị không tự tôi chạy được.

## 9. Việc đã làm ngoài đặc tả

- Tệp mô tả hàng của Buyer, khóa bằng chữ ký (tệp này không có trong đặc tả; đặc tả mục 2.3 cấm tính năng giao hàng số, tệp mô tả không phải giao hàng nhưng nên bạn xác nhận).
- Nút xóa bản nháp, trang claim cho ví phạt.

## 10. Quyết định D01–D15 đang chờ

Chưa có câu trả lời cho D01 đến D15. Các điểm tôi sẽ chạm đầu tiên: D04 (nhà cung cấp tin nhắn, kho bằng chứng, trợ lý AI), D05 (ví phạt chính thức, nhiều chữ ký), D09 (cỡ và loại tệp), D01/D02 (pháp nhân, độ tuổi, khu vực). Danh sách được chép vào `docs/DECISIONS.md`.
