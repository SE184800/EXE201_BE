# Vercel + Azure SQL (bản demo)

## Trạng thái

- Azure SQL đã được tạo tại East Asia: `supplymind-duy-demo.database.windows.net`, database `supplymind`.
- Free offer bật, overage billing tắt. Hết hạn mức thì database dừng đến tháng sau.
- Cấu hình Vercel có trong `vercel.json`; chưa coi là online cho đến khi deploy và kiểm tra đăng nhập thành công.

## Cách triển khai

1. Trong BE chạy `npm run deploy:prepare` để build FE vào `public` với API cùng domain `/api`.
2. Đăng nhập Vercel CLI bằng `npm exec --yes --package=vercel -- vercel login` và dùng gói Hobby.
3. Link/tạo project từ thư mục BE bằng CLI; không cần cấp quyền repository GitHub.
4. Đặt `DATABASE_URL` và `JWT_SECRET` (ngẫu nhiên ít nhất 32 ký tự) trong Environment Variables của Vercel. Không commit bí mật. Vercel tự cung cấp hostname cho kiểm tra Origin. Nếu dùng domain riêng, đặt `FRONTEND_URL=https://domain-cua-ban`.
5. Trước khi chạy API: cấu hình kết nối mạng Azure, tạo `.env.cloud` riêng chứa DATABASE_URL Azure rồi chạy `npm run db:migrate:cloud`. Script chỉ áp dụng migrations và tạo 3 vai trò, không tạo user/mật khẩu mẫu. Không chạy migrate reset.
6. Chạy `npm exec --yes --package=vercel -- vercel --prod` từ thư mục BE. Kiểm tra `/api/health`, `/login`, đăng ký/đăng nhập, kho hàng, tải lại trang con và đăng xuất.

Mẫu DATABASE_URL (thay mật khẩu trực tiếp trong giao diện/cấu hình riêng):

```text
sqlserver://supplymind-duy-demo.database.windows.net:1433;database=supplymind;user=supplymind_admin;password={YOUR_PASSWORD};encrypt=true;trustServerCertificate=false;connectionLimit=3;connectTimeout=60;poolTimeout=60
```

Nên dùng user SQL riêng với quyền đọc/ghi trong database cho runtime; chỉ dùng admin để migrate.

## Mạng và giới hạn

Vercel Hobby không có IP outbound cố định. Azure SQL hiện chưa được mở rộng firewall cho Vercel. Cần quyết định phạm vi truy cập trước khi deploy đầy đủ; không tự thêm rule toàn Internet. Nếu chấp nhận rule rộng cho demo, phải xác nhận riêng, giữ TLS và mật khẩu mạnh, dùng user runtime giới hạn quyền. Không dùng dữ liệu cá nhân thật để demo.

Rate limit đang nằm trong bộ nhớ từng function instance, không phải hạn mức chung toàn hệ thống. Bản demo không phù hợp để coi đây là lớp chống lạm dụng duy nhất cho ứng dụng công khai quy mô lớn.

## Ngày mai cập nhật

Sửa code FE/BE, chạy `npm run deploy:prepare`, chạy kiểm tra liên quan rồi `vercel --prod` lại từ thư mục BE đã link. Nếu thay đổi schema thì thêm migration và chạy `npm run db:migrate:cloud` trước. Dữ liệu Azure không mất khi redeploy web. `.vercelignore` loại `.env`, các file bí mật, Git metadata và dữ liệu seed khỏi upload.

Migrations chạy riêng, không chạy trong mỗi request serverless. Không upload toàn bộ dữ liệu/mật khẩu SQL local. Giữ cấu hình Render cũ như phương án dự phòng; không tạo dịch vụ Render trong phương án này.
