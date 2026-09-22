# Deploy demo: Render Free + Azure SQL Free

## Trạng thái
Code đã được chuẩn bị để chạy FE và BE chung một URL HTTPS. Chưa có bản online cho đến khi tạo xong tài khoản hosting, Azure subscription, database, đẩy code và deploy thành công.

## 1. Chuẩn bị tài khoản và SQL
- Đăng ký Azure for Students bằng email trường nếu đủ điều kiện. Tài khoản đăng nhập Azure chưa đồng nghĩa có subscription.
- Azure SQL hub → Start free. Phải thấy **Free offer applied** và **Estimated Cost/Month = 0**. Chọn **Auto-pause the database until next month**, không chọn tính phí vượt hạn mức. Không chọn SQL Managed Instance hoặc VM.
- Tạo SQL database mới cho demo; không đổi database local. Ghi lại server host, tên database và tài khoản SQL tại nơi riêng tư. Không commit mật khẩu.
- Chỉ cho phép các outbound IP của Render service qua SQL firewall; thêm IP máy bạn nếu cần chạy dữ liệu mẫu từ máy. Không mở toàn bộ Internet. Tắt tùy chọn Defender/Log Analytics/backup dài hạn có phí nếu giao diện đề xuất.
- Đây là dịch vụ có hạn mức: Azure có thể dừng khi hết hạn mức; không cam kết luôn hoạt động miễn phí vô hạn.

## 2. Đóng gói và đưa code lên GitHub
Hai repo FE/BE vẫn giữ nguyên. Đặt `EXE201_FE` cạnh `EXE201_BE` (hoặc giữ cấu trúc `FE/EXE201_FE` và `BE/EXE201_BE`). Trong `EXE201_BE` chạy:

```powershell
npm run deploy:prepare
```

Lệnh build FE ở thư mục kế bên và chép kết quả vào BE/public với API cùng origin `/api`, không chép `.env` hoặc database. Nếu để FE ở nơi khác, đặt biến môi trường `FRONTEND_DIR` trỏ tới thư mục đó trước khi chạy. Commit BE/public cùng các thay đổi BE vào repo backend. Không chỉ push repo FE vì Render chạy bản đã đóng gói trong BE.

## 3. Render
- Đăng nhập Render, kết nối đúng repo backend. Dùng Blueprint `render.yaml` hoặc tạo Web Service với cấu hình dưới đây.
- Plan **Free**, runtime Node, Node 22.14.0. Không thêm disk hay database Postgres.
- Build: `npm ci --include=dev && npm run db:generate`
- Start: `npm run start:deploy`
- Health: `/api/health`
- Environment: `NODE_ENV=production`, `SERVE_WEB=true`, `TRUST_PROXY_HOPS=1`, `JWT_SECRET` ngẫu nhiên ít nhất 32 ký tự và `DATABASE_URL` của SQL online.
- `RENDER_EXTERNAL_URL` do Render cấp được dùng làm origin. Nếu dùng tên miền khác, đặt `FRONTEND_URL=https://...` chính xác.
- Không có API key thì bỏ trống OPENAI_API_KEY và OPENAI_MODEL, ứng dụng vẫn chạy chế độ cơ bản.

Chuỗi kết nối Prisma 6 mẫu (thay giá trị, không đưa chuỗi thật vào Git/chat):

```text
sqlserver://YOUR_SERVER.database.windows.net:1433;database=YOUR_DATABASE;user=YOUR_SQL_USER;password={YOUR_PASSWORD};encrypt=true;trustServerCertificate=false;connectionLimit=3;connectTimeout=60;poolTimeout=60
```

Nếu mật khẩu chứa ký tự đặc biệt, dùng quy tắc escape SQL Server connector; không tự URL-encode như PostgreSQL.

Start script đợi database thức dậy, chạy `prisma migrate deploy`, bổ sung 3 role nếu thiếu rồi chạy server. Không reset database, không seed mật khẩu mặc định hoặc sao chép tài khoản cá nhân lên mạng. Cookie dùng Secure/HttpOnly/SameSite=None ở production; API vẫn kiểm tra Origin và header chống CSRF. Bản đóng gói FE và BE chạy cùng origin.

## 4. Dữ liệu demo
Đăng ký một tài khoản chủ tạp hóa trên web online. Có thể dùng hai file SQL dữ liệu mẫu đã có, đổi @username cho đúng tài khoản và chạy trên **database online**: SupplyMindAI_30SanPhamMau.sql rồi SupplyMindAI_GiaMau.sql. Không chạy SQL tạo bảng cũ sau khi migrations đã chạy. Không tự sao chép người dùng, password hash hay phiên đăng nhập từ máy lên cloud.

## 5. Mai code tiếp
1. Sửa/test FE và BE local như cũ.
2. Chạy `npm run deploy:prepare` trong BE nếu FE thay đổi.
3. Commit/push thay đổi BE (gồm public và migrations nếu có) đến nhánh Render theo dõi; Render deploy lại, link service giữ nguyên.
4. Không chạy `migrate reset`. Có thay đổi DB thì migration phải tương thích với dữ liệu đang dùng; sao lưu trước thay đổi phá hủy.
5. Trước khi gửi cô: thử cửa sổ ẩn danh, đăng nhập, sửa hàng, xem lịch nhập, lưu kế hoạch, refresh đường dẫn /store, đăng xuất.

Render Free ngủ sau 15 phút không truy cập; lần mở đầu có thể mất khoảng một phút. Không tạo tác vụ ping giữ thức vì làm hao hạn mức. Health check không truy vấn DB, tránh tự đánh thức SQL bằng health polling. Với Azure, đóng SSMS sau khi dùng để không giữ kết nối vô ích.

## Nguồn kiểm tra 22/09/2026
- https://render.com/docs/free
- https://render.com/docs/web-services
- https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql
- https://www.prisma.io/docs/orm/v6/overview/databases/sql-server
