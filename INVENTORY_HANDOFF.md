# Bàn giao chức năng kho tạp hóa và chatbox

## Ghi nhận bán hàng và lịch sử nhập xuất

Đã áp dụng migration 005 trên máy hiện tại ngày 21/09/2026, tạo dòng tồn đầu kỳ cho hàng hiện có. Không thêm giao dịch mua/bán mẫu vào tài khoản người dùng. FE build/lint đạt; 17/17 test backend đạt, gồm giao dịch SQL, chống gửi lặp, bán đồng thời, phân quyền lịch sử và chặn ghi đè dữ liệu kho cũ.

Migration `202609210005_stock_movements` tạo bảng `stock_movements`. Chạy `npm run db:migrate`, dừng backend rồi chạy `npm run db:generate` và khởi động lại (Windows khóa DLL khi backend chạy).

Bảng gồm id UUID, itemId FK inventory_items, type (OPENING/RECEIPT/SALE/ADJUSTMENT), quantityChange (có dấu), quantityBefore, quantityAfter, productName, unit, note và createdAt. FK xóa theo sản phẩm. Tên/đơn vị được chụp tại thời điểm giao dịch để sửa tên sau này không thay lịch sử. Migration ghi một dòng OPENING cho mỗi hàng có sẵn, giữ nguyên tồn; không giả lập giao dịch quá khứ. Dữ liệu trước ngày bật lịch sử không truy hồi được.

- Tạo sản phẩm ghi tồn đầu kỳ; sửa số lượng trực tiếp ghi điều chỉnh, không tự gọi là bán hàng. Chỉ đổi đơn vị khi tồn cũ bằng 0.
- POST `/api/inventory/:id/movements`: `{ "type": "SALE", "quantity": 5, "note": "Bán tại quầy", "requestId": "UUID-v4-mới-cho-mỗi-thao-tác" }`. RECEIPT cộng kho; SALE trừ kho. Số lượng là số nguyên dương. Thử lại cùng thao tác phải giữ requestId để tránh trừ hai lần khi mạng lỗi.
- GET `/api/inventory/history?page=1`: 20 dòng mới nhất mỗi trang, trả movements và hasMore; chỉ xem kho mình.
- PUT sửa hàng nhận expectedUpdatedAt lấy từ lần tải kho; nếu thay đổi ở tab khác, báo 409 để người dùng tải lại. Cập nhật số tồn và ghi lịch sử trong cùng transaction. Bán vượt tồn và thao tác tranh chấp bị từ chối; tồn không được âm.
- Chưa có giá bán, thanh toán, doanh thu, quản lý lô hoặc hoàn/hủy giao dịch. Nhập thêm không tự thay hạn dùng; nếu nhiều lô, cập nhật hạn gần nhất ở form sửa sản phẩm.

Demo: chọn sản phẩm đang có 100 lon → bán 5 → tồn 95, lịch sử -5 → nhập thêm 10 → tồn 105, lịch sử +10 → hỏi chat số lượng sẽ nhận 105.

## Bổ sung hạn sử dụng

Theo yêu cầu giao diện mới: bỏ ô ngưỡng sắp hết, trạng thái tồn chỉ hiển thị còn hàng/hết hàng; nút tải lại kho có nền và chữ đậm. API cho phép bỏ `lowThreshold`; cột cũ được giữ để tương thích và không mất dữ liệu. Cảnh báo hạn dùng 7 ngày độc lập với ngưỡng tồn kho.

Migration mới `prisma/migrations/202609210004_inventory_expiry/migration.sql` thêm cột `expiryDate DATE NULL` vào `inventory_items`. Không xóa dữ liệu hoặc tự gán hạn cho hàng cũ/dữ liệu mẫu. Máy bạn cùng nhóm cần nhận code mới, chạy `npm run db:generate`, `npm run db:migrate`, rồi khởi động lại backend.

Form thêm/sửa có hạn sử dụng tùy chọn. API nhận `expiryDate: "2027-01-15"`; chuỗi rỗng hoặc null xóa hạn, bỏ trường giữ nguyên hạn khi sửa bằng client cũ. Ngày sai lịch bị từ chối. GET trả thêm `daysUntilExpiry` và `expiryLabel`. Ngày tính theo lịch Việt Nam UTC+7: 0 = hết hạn hôm nay, âm = đã quá hạn; cảnh báo trong 7 ngày tới. Tải lại kho để cập nhật số ngày nếu để trang mở qua đêm.

Chat hỗ trợ “Coca còn bao lâu hết hạn?”, “Hàng nào sắp hết hạn?”, “Hàng nào đã hết hạn?”. Danh sách cảnh báo hạn chỉ tính hàng còn tồn và có ngày được nhập. Chưa biết hạn thì bot báo rõ, không suy đoán. Mỗi sản phẩm lưu một ngày; nếu nhiều lô, nhập hạn gần nhất, chưa theo dõi số lượng theo từng lô.

## Đã thực hiện trên máy hiện tại ngày 21/09/2026

- Đã generate Prisma client và áp dụng migration `202609210003_inventory` vào SQL Server cấu hình trong BE/.env.
- Đã chạy seed kho cho username `taphoa` với 5 sản phẩm mẫu bên dưới. Không thay mật khẩu hoặc sửa dữ liệu tài khoản.
- Kiểm tra đạt: FE build, FE lint và 15/15 test backend, bao gồm kiểm thử dữ liệu thật trên SQL Server và cô lập kho giữa hai chủ tiệm. Tài khoản kiểm thử tạm được dọn sau test.
- Đã sửa script `npm test` thành `node --test` để chạy được trên Windows/Node 20 (cú pháp glob cũ không hoạt động trên máy này).

## Phạm vi

Giữ nguyên SQL Server. Mỗi tài khoản STORE_OWNER có kho riêng. Chủ tiệm thêm/sửa tên hàng, đơn vị, tồn kho và ngưỡng cảnh báo. Chatbox đọc database theo mẫu câu, không gọi AI và không được sửa dữ liệu. Lịch sử chat chỉ nằm trong trình duyệt đến khi rời trang/tải lại.

## Bạn trong nhóm cần nhận những gì?

Nhận toàn bộ thay đổi FE và BE cùng nhau, đặc biệt schema Prisma, migration mới, routes/inventoryRoutes.js, services/inventoryChat.js, app.js và giao diện StoreInventory. Không gửi file .env, mật khẩu hay node_modules. Giữ cấu hình DATABASE_URL của máy người nhận.

Trong thư mục BE/EXE201_BE chạy:

```powershell
npm ci
npm run db:generate
npm run db:migrate
node prisma/seed-inventory.js taphoa
npm run dev
```

Database mới hoàn toàn: trước khi seed kho, chạy `npm run db:seed` theo README để tạo role và tài khoản (cần SEED_PASSWORD). Database đã có tài khoản: không cần chạy seed tài khoản. Có thể thay `taphoa` bằng username STORE_OWNER hiện có. Script kho không tạo hoặc thay mật khẩu tài khoản.

Trong thư mục FE/EXE201_FE: `npm ci`, rồi `npm run dev`. Đăng nhập bằng tài khoản đã seed kho.

## Thay đổi SQL

Migration: `prisma/migrations/202609210003_inventory/migration.sql` là toàn bộ SQL tạo bảng, có thể gửi để review. Dùng `npm run db:migrate` để thực thi và ghi nhận lịch sử Prisma; không chạy SQL thủ công rồi chạy lại migration vì sẽ trùng bảng. Không dùng migrate reset và không xóa database.

Thêm bảng `dbo.inventory_items`:

| Cột | Kiểu | Ý nghĩa |
| --- | --- | --- |
| id | INT IDENTITY | Khóa chính |
| ownerId | INT | FK tới users.id, kho thuộc tài khoản tạp hóa |
| name | NVARCHAR(100) | Tên hàng; duy nhất trong từng kho |
| unit | NVARCHAR(20) | Đơn vị tính |
| quantity | INT | Số lượng nguyên không âm, mặc định 0 |
| lowThreshold | INT | Ngưỡng nguyên không âm, mặc định 5 |
| createdAt | DATETIME2 | Thời điểm tạo |
| updatedAt | DATETIME2 | Thời điểm cập nhật bởi Prisma |

Xóa tài khoản sẽ xóa kho liên quan. Không sửa hoặc xóa bảng/tài khoản hiện có. Không thêm bảng lịch sử chat. Cảnh báo khi quantity <= lowThreshold; quantity = 0 hiển thị hết hàng. Mỗi sản phẩm dùng một đơn vị; chưa quy đổi thùng sang lon.

## Dữ liệu mẫu tùy chọn

`prisma/seed-inventory.js` chứa đầy đủ dữ liệu để máy bạn cùng nhóm tạo lại. Script gắn hàng vào username được chỉ định, không dùng ID tài khoản cố định. Chạy lại giữ nguyên hàng đã có cùng tên, không ghi đè tồn kho đã sửa.

| Sản phẩm | Đơn vị | Tồn | Ngưỡng |
| --- | --- | --- | --- |
| Coca lon 330ml | lon | 24 | 6 |
| Coca chai 1.5L | chai | 4 | 5 |
| Mì Hảo Hảo tôm chua cay | gói | 15 | 10 |
| Sữa Vinamilk 180ml | hộp | 3 | 6 |
| Nước suối Lavie 500ml | chai | 0 | 6 |

## API

Tất cả endpoint cần cookie đăng nhập và role STORE_OWNER; request ghi dữ liệu cần header CSRF như API hiện tại. Backend tự lấy ownerId từ phiên, không tin ownerId do client gửi.

- GET /api/inventory: danh sách kho của mình.
- POST /api/inventory: tạo hàng, body `{ "name": "Coca lon 330ml", "unit": "lon", "quantity": 24, "lowThreshold": 6 }`.
- PUT /api/inventory/:id: sửa bằng cùng body, chỉ sản phẩm thuộc kho mình.
- POST /api/inventory/chat: body `{ "message": "Coca còn bao nhiêu?" }`, trả answer, items, checkedAt.

## Kiểm tra demo

1. Đăng nhập taphoa; thấy 5 mặt hàng sau seed.
2. Hỏi “Coca còn bao nhiêu?”: thấy 2 loại, bot yêu cầu tên cụ thể.
3. Hỏi “mi hao hao con bao nhieu”: trả 15 gói.
4. Hỏi “Hàng nào sắp hết?”: Coca chai, sữa, Lavie.
5. Sửa Coca lon thành 12, hỏi lại: trả 12 lon.
6. Đăng nhập tài khoản tạp hóa khác: không thấy kho của taphoa.
7. Chủ vựa/admin không được gọi API kho này.

Test không cần DB: `node --test tests/inventory.test.js`. Toàn bộ test: `npm test` cần SQL Server đã migrate và có role. FE: `npm run build`, `npm run lint`.
