# SupplyMind AI Backend

Node.js, Express.js, Prisma ORM, Microsoft SQL Server và JWT Authentication.
Prisma 6.19.3 được cố định để dùng Windows Integrated Authentication trực tiếp trên máy Windows.

## Chạy local

1. Cài Node.js 24 và SQL Server Express, bật TCP/IP của instance và cổng 1433.
2. Trong SSMS, tạo database mới tên `supplymindAI` nếu chưa có.
3. Chạy `npm ci`, sao chép `.env.example` thành `.env` và điền cấu hình.
4. Tạo JWT secret bằng `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
5. Đặt `SEED_PASSWORD` riêng (ít nhất 12 ký tự), dùng để tạo ba tài khoản ban đầu.
6. Chạy lần lượt `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`.
7. Chạy `npm run dev`. Backend mặc định ở `http://localhost:5000`.

Windows Authentication sử dụng tài khoản Windows đang chạy terminal. Dùng cùng tài khoản đã kết nối SSMS; nếu dùng SQL Authentication, sửa DATABASE_URL theo ví dụ trong `.env.example`.

## Tài khoản và phân quyền

| Username tạo bởi seed | Role | Trang FE |
| --- | --- | --- |
| taphoa | STORE_OWNER | /store |
| chuvua | SUPPLIER | /supplier |
| admin | ADMIN | /admin |

Mật khẩu khởi tạo lấy từ `SEED_PASSWORD`. Seed chạy lại giữ nguyên mật khẩu, vai trò và trạng thái tài khoản đã có. Không commit `.env`. Các tài khoản mẫu chỉ phục vụ phát triển local, thay bằng tài khoản riêng trước khi triển khai.

Prisma khai báo ba bảng: `roles`, `users`, `auth_sessions`. SQL Server còn có bảng `_prisma_migrations` do Prisma quản lý. Chưa tạo bảng nghiệp vụ nhập hàng vì giai đoạn này thực hiện đăng nhập và đăng ký.

Email và số điện thoại có unique filtered index trong migration `202609210003_unique_registration_contacts`. Các giá trị khác NULL không được trùng; tài khoản seed/admin vẫn được để trống thông tin liên hệ. Prisma 6 chưa biểu diễn bộ lọc này trong schema, nên cần giữ file migration SQL khi push/pull và dùng `npm run db:migrate`, không thay bằng `db push`. Tham khảo [SQL Server trong Prisma 6](https://docs.prisma.io/docs/orm/v6/overview/databases/sql-server).

## API

- `POST /api/auth/login`: `{ "username": "...", "password": "..." }`.
- `POST /api/auth/register`: `{ name, username, email, phone, role, dateOfBirth, password, confirmPassword }`. Role chỉ nhận `STORE_OWNER` hoặc `SUPPLIER`; ngày sinh dạng `YYYY-MM-DD`. Trả 201 khi thành công, 400 khi dữ liệu sai, 409 khi trùng tài khoản; lỗi trường nằm trong object `errors`. Giới hạn 5 yêu cầu/15 phút/IP trả 429 bằng JSON tiếng Việt kèm `Retry-After`.
- `GET /api/auth/me`: thông tin phiên đăng nhập.
- `POST /api/auth/logout`: thu hồi phiên hiện tại.
- `GET /api/workspaces/store|supplier|admin`: chỉ đúng role được vào.
- `GET /api/users`: admin xem tối đa 100 tài khoản.
- `POST /api/users`: admin tạo tài khoản với `username`, `password`, `name`, `role`.

JWT được lưu trong HttpOnly cookie, thời hạn 8 giờ, không lưu trong localStorage. Mọi request ghi dữ liệu cần header `X-CSRF-Protection: sg-restock-web`; browser Origin phải khớp `FRONTEND_URL`. Cookie Secure được bật ở production. Production cần HTTPS và FE/API cùng site; cấu hình reverse proxy `/api` là cách đơn giản nhất.

Role và trạng thái hoạt động luôn được đọc từ database. Logout xóa session nên JWT cũ không thể dùng lại. Public registration chỉ cho phép `STORE_OWNER` và `SUPPLIER`; tài khoản Admin do hệ thống cấp. Chưa triển khai đổi/quên mật khẩu hoặc Google OAuth.

## Kiểm tra

`npm test` chạy kiểm thử API với SQL Server đã migrate và seed. Test tạo tài khoản có tiền tố ngẫu nhiên, chỉ xóa đúng các tài khoản tạm của lượt chạy đó. Bao gồm đăng ký → lưu SQL → đăng nhập, validation, hai yêu cầu trùng gửi đồng thời, ràng buộc SQL, giới hạn đăng ký, ba role, cookie JWT, logout, khóa tài khoản, CSRF và bảo vệ API users.

Chỉ chạy migration đã review. Không cần `migrate reset` hay xóa database.
