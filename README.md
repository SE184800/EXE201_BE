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

Prisma có các bảng tài khoản, kho, gian hàng, đơn hàng, cấu hình nền tảng, nhật ký và theo dõi AI. SQL Server còn có bảng `_prisma_migrations` do Prisma quản lý. Kho riêng của tiệm và danh mục bán sỉ của vựa là hai nguồn dữ liệu khác nhau.

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

## Nhận code kho tạp hóa + chủ vựa

Pull cả FE và BE. Dừng BE trước khi generate trên Windows để tránh khóa DLL Prisma. Giữ `.env` riêng của máy:

```powershell
npm ci
npm run db:migrate
npm run db:generate
npm run dev
```

Có 11 migration trong repo. Giữ nguyên tên đầy đủ, kể cả hai migration có chung tiền tố 003 hoặc 004; chúng có tên khác nhau. Migration `202609220003_platform_admin` bổ sung dữ liệu quản trị nền tảng; dùng `npm run db:migrate` để áp dụng.

Đoạn SQL kho được chia sẻ riêng tương ứng ba migration `202609210003_inventory`, `202609210004_inventory_expiry`, `202609210005_stock_movements`. Máy chưa chạy SQL thủ công chỉ cần `npm run db:migrate`. `migrate resolve --applied` chỉ ghi lịch sử; dùng nó khi đã đối chiếu bảng/cột/index/constraint và SQL của migration thực sự chạy đủ trên database đó. Không dùng để bỏ qua migration chưa thực thi. Database máy hiện tại đã chạy đủ 7 migration bằng Prisma; không cần dán lại SQL hay resolve.

## Chủ vựa đăng hàng → tạp hóa xem nguồn sỉ

- `GET /api/supplier/dashboard`, `GET|PUT /api/supplier/profile`: gian hàng, kho, bán kính và tổng quan. Role SUPPLIER.
- `GET|POST /api/supplier/products`, `PUT|DELETE /api/supplier/products/:id`: danh mục riêng. POST/PUT nhận `name`, `packaging`, `wholesalePrice`, `stockQty`, `moq`, `isActive`. PUT bắt buộc `expectedUpdatedAt` lấy từ lần đọc sản phẩm để chặn ghi đè tồn kho mới. DELETE chỉ ẩn; PUT `isActive: true` đăng lại.
- `GET /api/supplier/orders`, `PATCH /api/supplier/orders/:id/status`: chờ duyệt → duyệt → chuẩn bị → vận chuyển → đã giao; từ chối đơn chờ duyệt cần lý do tối đa 255 ký tự. Duyệt và trừ kho trong cùng transaction, chặn duyệt lặp.
- `GET /api/catalog/products?q=...&supplierId=...&page=1`: role STORE_OWNER, 24 sản phẩm/trang, trả `hasMore`. Tìm theo tên hàng hoặc tên vựa, lọc một vựa. Chỉ hàng `isActive` của tài khoản chủ vựa đang hoạt động được hiển thị. Hết tồn vẫn hiển thị rõ hết hàng.
- `GET /api/catalog/suppliers`: danh sách vựa có hàng đang hiển thị. Chỉ trả thông tin gian hàng, không công bố email, tài khoản đăng nhập hay mật khẩu.

Đăng bán lưu SQL thật. Gian hàng phải được admin xác minh trước khi sản phẩm xuất hiện trên Tìm nguồn sỉ. Trang này hỗ trợ xem/tìm/lọc và đặt đơn; chủ vựa duyệt đơn rồi cập nhật tiến độ giao. Hàng thực nhận vẫn cần được chủ tạp hóa ghi nhận vào kho. Test `catalog.test.js` kiểm tra việc công bố, ẩn/đăng lại, sửa giá, cô lập vựa, CSRF, khóa tài khoản, phân trang và duyệt đồng thời. Bộ test chạy tuần tự giữa các file; kiểm thử đồng thời vẫn thực hiện trong từng bài test.
