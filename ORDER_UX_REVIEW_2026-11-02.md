# Rà soát đơn mua hàng ngày 02/11/2026

## Giao diện

- Chữ nội dung 15–16px, nút thao tác tối thiểu 44px; giữ tên hàng và số tiền nổi bật, hỗ trợ nút xuống dòng trên điện thoại.
- Bỏ ký hiệu trang trí, từ tiếng Anh khó hiểu và thông báo lặp. Ghi chú, chi tiết cọc được thu gọn; thông tin giao hàng, số tiền cần trả và thao tác chính vẫn hiện rõ.
- Không tự điền số điện thoại, tài khoản ngân hàng hoặc giờ đến mẫu khi thiếu thông tin.
- Đơn bị từ chối không còn ghi “Còn phải trả”. Số tiền tổng đơn và số tiền còn trả được phân biệt; cọc chưa xác nhận không được trừ.

## Ai quyết định giờ giao

Cửa hàng đề nghị giờ muốn nhận. Chủ vựa xác nhận hoặc từ chối; lịch đã xác nhận chỉ đổi khi chủ vựa đồng ý. Mỗi đơn chỉ có một đề nghị chờ trả lời. Có thể gửi đề nghị mới sau khi đề nghị cũ đã được xử lý.

Backend kiểm tra ngày hợp lệ, giờ 08:00–17:00, báo trước ít nhất một giờ và trong 90 ngày. Không đổi giờ sau khi nhận hàng. Yêu cầu mới được lưu thành dữ liệu riêng trong thông tin giao nhận, không ghép vào ghi chú đơn. Ghi chú cũ vẫn được đọc để tương thích.

## Nhập kho sau nhận hàng

Cửa hàng bấm Nhập kho sau khi nhận và kiểm đủ hàng; không cần đợi thanh toán. Không tự cộng kho khi chỉ chấp nhận báo giá, xác nhận hàng đến hoặc chuyển trạng thái đơn. Đang có khiếu nại hoặc báo hàng hỏng phải xử lý trước.

Mặt hàng mới được tạo; mặt hàng có sẵn thêm lô riêng theo đơn. Giao dịch nhập, số lượng và dấu đã nhập được ghi chung transaction; bấm lại không cộng thêm. Nhập kho không tự ghi nhận đã trả tiền hoặc hoàn tất đơn. Ký gửi được giữ nhãn khi nhập từ đơn báo giá.

## Thanh toán

- Đã thanh toán đủ bằng ví không được thu thêm tiền mặt/chuyển khoản.
- Chỉ báo trả tiền sau khi nhận hàng. Server tính số tiền cần trả, kiểm tra cọc đã trả và giảm hàng hỏng; không tin số tiền client gửi.
- Chỉ xác nhận tiền sau khi cửa hàng đã báo trả; gửi lại không làm mất trạng thái đã xác nhận.
- Không hoàn tất khi có khiếu nại chưa xử lý. Đơn trả bằng ví cũng có nút hoàn tất.
- QR chỉ dùng tài khoản chủ vựa hợp lệ; không chuyển sang tài khoản mẫu khi thiếu thông tin.
- Ngân hàng chưa được tích hợp đối soát tự động. Chuyển khoản ngoài app phải được chủ vựa kiểm tra rồi xác nhận thủ công. Đây là giới hạn còn lại, không phải một giao dịch ngân hàng tự động đã hoàn tất.
- Công cụ thử cọc có nhãn không chuyển tiền, thu gọn riêng. Production chỉ cho tài khoản demo sử dụng endpoint thử cọc.
- Đặt nhiều đơn dùng lại request ID khi gửi lại cùng nội dung trong phiên đặt hàng để tránh tạo trùng/giữ cọc lại sau lỗi mạng.

## Báo giá tiếp thị

Thêm chiết khấu phần trăm từng mặt hàng (0–100%, tối đa hai số lẻ). Server lưu giá gốc, tỷ lệ và giá sau giảm; tính tổng, cọc từ giá sau giảm. Hai bên đều thấy mức giảm. Đơn tạo từ báo giá dùng đúng giá đã giảm, không giảm lần hai.

Chấp nhận báo giá ký gửi tạo đơn, chưa cộng kho trước lúc hàng đến. Bỏ các cam kết UI không có luồng tự động tương ứng như tự điều xe giao bù hoặc tự đổi hàng 100%; ghi rõ cần gửi yêu cầu và chờ chủ vựa xác nhận.

## Kiểm tra và áp dụng

- 151/151 test backend đạt trên DB test riêng; 14/14 test frontend đạt. TypeScript, build production và ESLint đạt.
- Có kiểm thử API cho phân quyền, trạng thái, báo/nhận tiền, bấm lặp, khiếu nại, đề nghị giờ giao và xác nhận, chiết khấu tạo đơn và ký gửi chỉ nhập sau nhận hàng.
- Đã chạy 27 migration và generate Prisma Client trên DB local supplymindAI. Migration mới: 20261102130000_quote_line_discounts, chỉ thêm hai cột vào dòng báo giá; không reset dữ liệu.
- Đã mở kiểm tra màn đơn và hộp đề nghị đổi giờ trên bản local. Chưa thử một giao dịch ngân hàng thật hoặc đo lường khả năng sử dụng với người cao tuổi.
- Cảnh báo bundle lớn và cảnh báo dependency đã ghi ở báo cáo trước vẫn còn. Không tuyên bố toàn hệ thống không thể phát sinh lỗi.

Chỉ sửa, test và commit local trên main; chưa push GitHub, deploy hoặc thay đổi DB online trong đợt này. Không đưa .env và dữ liệu test vào commit.
