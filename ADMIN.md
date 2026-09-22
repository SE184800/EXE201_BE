# Quản trị SupplyMind AI

## Nhận code và chạy

Pull cả hai repository FE/BE. Trong BE, dừng process dev trước khi generate trên Windows:

```powershell
npm ci
npm run db:migrate
npm run db:generate
npm run dev
```

FE: `npm ci`, `npm run dev`. Mở `http://localhost:5173/login`, đăng nhập tài khoản có role `ADMIN`; hệ thống chuyển tới `/admin`. Tài khoản `admin` do seed tạo, mật khẩu là giá trị `SEED_PASSWORD` lúc tạo lần đầu; chạy lại seed không đổi mật khẩu hiện có. Không đăng ký public role ADMIN.

Migration mới `202609220003_platform_admin` thêm `platform_settings`, `audit_logs`, `ai_usage_events`, `recommendation_runs`; bổ sung trạng thái khóa tài khoản, hồ sơ xác minh và dữ liệu hoa hồng. Không xóa bảng hoặc dữ liệu cũ. Không dùng `db push`, `migrate reset` hay tự đánh dấu migration đã chạy.

## Các luồng

1. Chủ vựa lưu thông tin kho và chuẩn bị sản phẩm. Tại **Xác minh gian hàng**, bổ sung tỉnh/thành kho, mã đăng ký kinh doanh/mã số thuế, người đại diện và đường dẫn HTTPS tới giấy tờ. Gửi hồ sơ → `PENDING`.
2. Admin mở **Xác minh chủ vựa**, kiểm tra giấy tờ và liên hệ, chấp thuận hoặc từ chối kèm nhận xét. Đây là kiểm duyệt thủ công, không phải dịch vụ KYC tự động hay xác minh pháp lý từ cơ quan đăng ký.
3. Chỉ sản phẩm đang bật bán của tài khoản còn hoạt động, gian hàng `APPROVED`, xuất hiện trong nguồn sỉ và được đặt mua. Có thể thu hồi phê duyệt. Đổi thông tin nhận dạng gian hàng/địa chỉ/giấy tờ sẽ đưa hồ sơ về `DRAFT` và cần gửi lại. **Gian hàng có sẵn cũng cần được duyệt; migration không tự xác minh đối tác.**
4. **Người dùng**: tìm kiếm và phân trang chủ tạp hóa/chủ vựa. Khóa tạm có ngày kết thúc; khóa vĩnh viễn có thể được admin mở lại sau khi xem xét. Cả hai yêu cầu lý do và thu hồi toàn bộ phiên hiện tại. Không cho khóa admin qua API này. Hết khóa tạm, người dùng đăng nhập lại; phiên cũ không hồi sinh.
5. Chủ tạp hóa đặt hàng từ danh mục → chủ vựa duyệt (trừ tồn đúng một lần) → chuẩn bị → vận chuyển → xác nhận giao và thu COD → đơn phát sinh công nợ hoa hồng. Tồn kho tạp hóa vẫn cần ghi nhận theo hàng thực nhận.
6. **Hoa hồng & đối soát**: admin chọn kỳ ngày giao, lọc theo mã chủ vựa và trạng thái thu; xuất CSV mở được bằng Excel. Sau khi nhận đủ phí, admin nhập mã giao dịch/phiếu thu để xác nhận từng đơn. Hệ thống ghi nhận thủ công, không chuyển tiền hoặc đối chiếu ngân hàng tự động. Không có API ghi đè/xóa chứng từ đã xác nhận.

## Quy ước tài chính và thống kê

- Mức phí ban đầu **0%**, admin cấu hình từ 0–100% (2 chữ số thập phân). Nhóm cần tự chốt tỷ lệ phù hợp.
- Chụp tỷ lệ tại **thời điểm tạo đơn**, không nhận tỷ lệ/tổng tiền từ FE. Phí phát sinh khi **giao thành công** = `subtotal × commissionRate / 100`, làm tròn 2 chữ số thập phân. Không tính trên tiền vận chuyển. Đổi phí sau này không sửa đơn đã tạo.
- GMV = tổng **tiền hàng** của đơn đã giao trong kỳ, không gồm phí giao hàng. Hoa hồng đã thu tính theo ngày xác nhận thu trong kỳ; phí phát sinh/chưa thu tính theo ngày giao. Vì vậy tiền đã thu có thể thuộc đơn giao ở kỳ trước.
- Kỳ báo cáo bao gồm cả hai ngày theo **UTC+7**, tối đa 366 ngày. Xuất CSV tối đa 10.000 đơn/lần; thu hẹp kỳ/chủ vựa nếu vượt giới hạn. CSV bảo vệ ô bắt đầu bằng công thức.
- Bảng mặt hàng bán chạy xếp theo giá trị đã giao, nhóm theo sản phẩm + tên/quy cách tại thời điểm đặt + **khu vực kho chủ vựa** tại thời điểm đặt. Đây chưa phải khu vực người mua; khu vực hiện được nhập văn bản, nhóm nên thống nhất cách ghi tỉnh/thành.
- Đơn cũ không có ngày giao không được gán ngày giả để đưa vào thống kê. Đơn cũ chưa chụp tỷ lệ không được tính phí ngược; giao thành công vẫn hiển thị “thiếu dữ liệu phí”, không cho xác nhận thu. Không phải mọi đơn cũ đều đã có dữ liệu báo cáo đầy đủ.

## Theo dõi AI

Backend hỗ trợ cấu hình Gemini hoặc OpenAI qua `AI.env.example` (chỉ điền trong `.env` BE). Cấu hình Gemini cần `AI_PROVIDER=GEMINI`, `GEMINI_API_KEY`, `GEMINI_MODEL` mà tài khoản có quyền dùng. Giữ hỗ trợ OpenAI đang có. Không tự gọi dịch vụ ngoài trong test: response provider được giả lập.

- Lưu provider/model, kết quả, thời gian xử lý, token khi nhà cung cấp trả về. Không lưu câu hỏi, câu trả lời, mật khẩu hay API key vào bảng theo dõi. `RULES` là xử lý nội bộ; `ERROR` là lần gọi lỗi chuyển sang câu trả lời dự phòng; `STARTED` là lần chưa ghi nhận kết thúc (ví dụ process bị dừng).
- Tỷ lệ sử dụng đề xuất = lượt dự báo có ít nhất một lượng nhập được lưu **đúng số lượng đề xuất của server** vào kế hoạch trong 24 giờ / lượt dự báo có ít nhất một đề xuất dương, loại hàng `[Mẫu]`. Chỉ tính một lần cho mỗi lượt, kiểm tra đúng chủ kho và cùng kỳ dự báo/dự phòng. Sửa/lưu lại không nhân đôi lượt chấp nhận.
- Đây là chỉ số chấp nhận, **không phải độ chính xác dự báo**. Lượt xem lại dự báo được tính thành lượt mới. Chưa có đủ dữ liệu thực tế để đánh giá sai số dự báo nhu cầu.
- **API thời tiết chưa được tích hợp vào dự án.** Admin hiển thị trạng thái chưa tích hợp; không tạo lượt gọi hay dữ liệu giả. Khi nhóm chọn dịch vụ thời tiết và kết nối luồng gọi thật, cần bổ sung ghi nhận usage tại điểm gọi.
- Thông số hiện tại nằm tại `/api/admin/ai`. Tham khảo API Gemini chính thức: https://ai.google.dev/api/generate-content.

## Nhật ký và phân quyền

Mọi `/api/admin/*` yêu cầu session role `ADMIN`; thao tác ghi yêu cầu CSRF. Nhật ký chỉ đọc từ UI/API, lưu actor ID, loại đối tượng, thời gian và thay đổi: khóa tài khoản, duyệt đối tác, cấu hình/thu phí, tạo/sửa/ẩn hàng sỉ, tạo/duyệt/giao đơn, thay đổi kho/giá, hồ sơ cá nhân và mật khẩu (chỉ sự kiện, không lưu mật khẩu). Giao dịch nghiệp vụ và log tương ứng ghi cùng transaction. Xóa account không xóa lịch sử log; vẫn giữ actor ID, nhưng tên người đã xóa không còn được tra cứu.

Audit ở tầng ứng dụng từ thời điểm triển khai; chỉnh trực tiếp bằng SSMS không đi qua log này. Muốn giám sát cả thay đổi do người có quyền database cần thêm chính sách SQL Server Audit riêng. Không có API sửa hoặc xóa log.

## Kiểm thử

`npm test` trong BE cần SQL Server local đã migrate. Suite admin kiểm tra role/CSRF, KYC cạnh tranh và thay đổi hồ sơ, khóa/hết hạn/mở lại, ẩn sản phẩm, đặt hàng chống gửi lặp, snapshot mức phí và tính phí, thu phí cạnh tranh, CSV, thống kê theo ngày, Gemini giả lập và tỷ lệ chấp nhận đúng chủ kho. Test tạo/xóa riêng dữ liệu có tiền tố ngẫu nhiên. Suite phí tạm đổi cấu hình global rồi khôi phục, nên chạy trên DB phát triển, không chạy trên DB đang kinh doanh.

FE: `npm run build`, `npm run lint`, `npm test`.
