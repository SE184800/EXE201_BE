# Cập nhật Vercel SupplyMind ngày 01/11/2026

Project: `duy1006z-9828s-projects/supplymind-demo`.
Địa chỉ chính: https://supplymind-demo.vercel.app

- Mua/gia hạn Basic 19.000đ bằng số dư ví, giữ thời gian còn lại, chống xử lý yêu cầu lặp.
- Giữ luồng cọc chuyển khoản cũ; ký quỹ ví có kiểm tra ledger và chống hoàn/giải phóng lặp.
- Trên Vercel, hồ sơ cửa hàng, hợp đồng, giao nhận, ký gửi, nguồn hàng và cấu hình được lưu ở `application_documents`; ảnh tải lên lưu ở `application_uploads`. Không dùng thư mục ghi tạm để giữ dữ liệu lâu dài.
- Dữ liệu SQL online cũ được giữ nguyên. Đã bổ sung 4 migration kể từ bản online cũ: ví, sandbox, document storage, upload storage. Không chạy seed/reset production.
- AI dùng Gemini; key lưu ở `.env` trên máy và Secret của Vercel. Không commit key.
- Gemini đã trả lời thử thành công. Gmail SMTP đã xác thực thành công (không gửi email thử). Đã cấu hình thông tin nhận QR trên Vercel; mã ngân hàng đã đối chiếu là Sacombank. Các bí mật chỉ lưu trong .env và Secret của Vercel.

## Lần deploy sau

Trong BE: `npm ci`, `npm run db:generate`. Chạy migration production bằng cấu hình database online riêng khi có migration mới. Build FE vào `public` với `npm run deploy:prepare` (đặt FRONTEND_DIR đúng thư mục FE), rồi `vercel --prod` trên đúng project đã liên kết.

Không đưa `.env*`, `.vercel`, `node_modules`, thư mục `data` hoặc `.local-mail` vào gói chia sẻ có bí mật. Không ghi đè `.env` của máy khác.

## Kiểm tra

Frontend TypeScript/Vite build đạt. Có 48 kiểm thử API/nghiệp vụ/lưu trữ với SQL trên database test riêng, 4 kiểm thử cấu hình deploy và 3 kiểm thử hồ sơ cửa hàng đạt. Kiểm tra lưu trữ bao gồm request đồng thời, phiên máy chủ mới, lỗi lưu và ảnh tải lên.

## Kết quả deploy

Deployment: `dpl_D4RhNFwCBjDGCkLrFadWEeqMMspK`.
Bản này đã được promote lên `https://supplymind-demo.vercel.app`.
Kiểm tra URL chính: trang chủ phục vụ giao diện mới, `/api/health` trả OK, API thuê bao yêu cầu đăng nhập. Không thay mật khẩu người dùng và không chạy seed trên production.

## Website frontend chính

Frontend người dùng: https://supplymind-ai-three.vercel.app/login — project `supplymind-ai`.
Frontend này dùng rewrite `/api` sang backend `https://supplymind-demo.vercel.app/api` (project `supplymind-demo`). Cần cập nhật cả FE lẫn BE; hai project dùng chung database online qua backend. FE đã được promote lên deployment `dpl_FzVBScuryZoYPCgxK8VMn98Q5q5b`.

## Tài khoản demo riêng

Script `prisma/seed-test-accounts.js` tạo nhóm `demo_*_19k` cùng dữ liệu có nhãn `[DEMO19K]`, không sửa người dùng cũ. Chỉ chạy khi đã đặt `DEMO_ALLOW_ONLINE=yes`, `DEMO_PASSWORD` riêng, và `DEMO_ENV_FILE` trỏ tới file cấu hình database muốn nạp. Không commit mật khẩu demo hoặc file chứa DATABASE_URL.

Các tài khoản demo có tiền SANDBOX để test, không phải tiền thật. Tài khoản chủ vựa chờ duyệt phục vụ luồng duyệt hồ sơ. Tài khoản hết hạn có ví rỗng để thử thiếu tiền/nạp thử/gia hạn. Không bật lịch ngày lễ demo trên production; cấu hình demo được tạo ở trạng thái tắt để tránh ảnh hưởng dự báo của tài khoản thật.

## Bộ dữ liệu test đã nạp trên online

- `demo_taphoa_19k`: chủ tạp hóa với kho, lịch sử bán, đơn hàng, ký gửi, ví, hợp đồng và Basic đang hoạt động.
- `demo_chuvua_19k`: chủ vựa đã duyệt, có sản phẩm, báo giá, đơn hàng, giao nhận và lịch sử ví.
- `demo_admin_19k`: kiểm tra quản trị, đối soát, duyệt hồ sơ và yêu cầu rút tiền demo.
- `demo_hethan_19k`: gói hết hạn, ví rỗng; kiểm tra thiếu tiền, nạp thử và mua Basic.
- `demo_choduyet_19k`: hồ sơ chủ vựa đang chờ admin duyệt.

Mật khẩu demo được cung cấp riêng trong chat, không lưu ở mã nguồn. Các giao dịch/balance demo là mô phỏng; không chuyển tiền thật vào thông tin ngân hàng mẫu của chủ vựa demo.

Bộ dữ liệu gồm 8 sản phẩm sỉ, 8 sản phẩm kho, 240 lượt bán trong 30 ngày, 11 đơn hàng, 3 báo giá, 3 khiếu nại, 2 kế hoạch nhập hàng, hợp đồng và metadata ký gửi/giao nhận. Script chạy lại không đặt lại số dư hoặc mật khẩu đã có.

Backend được chuyển sang vùng Singapore (`sin1`) vì Gemini trả lỗi khu vực khi hàm Vercel chạy tại Hong Kong (`hkg1`).

Bản backend cuối: `dpl_841YrModh8jeu4YPWND5qdE1Cfw8` (Singapore), đã promote lên backend demo. Đã xác nhận chatbot trả `mode: AI` thông qua frontend chính `supplymind-ai-three.vercel.app`, và các tài khoản demo đăng nhập đúng vai trò; tài khoản hết hạn trả yêu cầu gia hạn như thiết kế.

## Kiểm tra tương thích với code nhánh Tri

Đã fetch GitHub: BE ở `5052eda`, FE ở `b478be3`, không có commit mới hơn trên origin/Tri tại thời điểm kiểm tra. ZIP ban đầu thay cả LoginPage và WalletPage nên làm mất UI OTP/quên mật khẩu và rút tiền chính thức. Đã ghép lại trên nền code gốc: giữ 11 helper/handler cũ của trang đăng nhập và 4 handler cũ của ví nguyên văn, khôi phục SupplierLayout, chỉ thêm logic mua Basic 19k và nhãn giao dịch tương ứng. Build TypeScript/Vite đạt. Giao diện OTP đã được mở kiểm tra thật.

Frontend sửa tương thích đã promote deployment `dpl_EbYpnsdbM2MMN2uZCjS92pPGzS2A`. Chưa commit/push các thay đổi lên GitHub. Khi nhận code cần áp dụng các migration mới trên đúng database riêng của từng môi trường. Azure SQL từng trả lỗi tạm thời 40613 trong lần kiểm tra đăng nhập; đây là trạng thái database, không phải bằng chứng mọi luồng giao diện đã được kiểm thử end-to-end.

Kiểm tra trực tiếp sau khi phục hồi: mở được màn hình quên mật khẩu/nhận OTP; đăng nhập tài khoản demo chủ vựa trên URL frontend chính; mở được ví, tab rút tiền, phương thức rút về ngân hàng và sandbox cùng các trường ngân hàng. Không gửi OTP, không đổi mật khẩu và không tạo giao dịch rút tiền trong lần kiểm tra UI. Azure SQL đã sẵn sàng trở lại; đăng nhập thử lại trả HTTP 200.
