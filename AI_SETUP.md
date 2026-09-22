# Chatbot và lịch nhập dự kiến

Đã triển khai kết nối OpenAI Responses API. Chưa có API key thì chatbot trả lời theo quy tắc và hiển thị **Chưa bật AI**; không giả vờ đã gọi mô hình.

## Bật chatbot AI
1. Tạo API key trên https://platform.openai.com/api-keys bằng tài khoản của bạn; kiểm tra quyền sử dụng và thanh toán API.
2. Mở `.env` trong thư mục BE/EXE201_BE, thêm `OPENAI_API_KEY=` và `OPENAI_MODEL=` theo AI.env.example, điền giá trị tại máy mình. Không đặt trong VITE_*, không gửi key vào chat/Git.
3. Chọn model hỗ trợ Responses API mà tài khoản có quyền dùng: https://developers.openai.com/api/docs/models . Không có model mặc định để tránh tự chọn chi phí ngoài ý muốn.
4. Khởi động lại backend bằng `npm run dev`, hỏi chatbot. Sau một câu trả lời thành công sẽ hiện **AI đang kết nối**. Khi lỗi dịch vụ/key/model sẽ báo rõ và quay về tra cứu cơ bản.

AI nhận câu hỏi, tối đa 6 tin nhắn gần nhất và tối đa 100 mặt hàng thuộc kho đang đăng nhập (tên, số tồn, giá nhập, hạn dùng và gợi ý). Không gửi hồ sơ cá nhân, mật khẩu, cookie hay thông tin tài khoản. Dùng store:false; đây không phải cam kết không lưu dữ liệu theo mọi chính sách nhà cung cấp. API chỉ đọc, không cho mô hình chạy SQL, đặt hàng hoặc sửa kho. Không đưa nội dung trả lời vào HTML thô.

Tài liệu kết nối: https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create . Lời giải thích từ mô hình vẫn cần đối chiếu bảng số liệu, đặc biệt phép tính ngân sách.

## Lịch nhập
- Menu Lịch nhập dự kiến; chọn thời gian giao hàng 0–14 ngày. Tính 14 ngày tới, ngày cần hàng đầu tiên, ngày nên đặt và lượng đủ cho 7 ngày + dự phòng 2 ngày.
- Tối đa 30 ngày lịch sử đã hoàn tất, loại ngày bắt đầu theo dõi, hôm nay và đơn vị cũ. Ít nhất 4 lần quan sát mỗi thứ mới dùng mức bán riêng theo thứ. Nếu chưa đủ: trung bình ngày khi có ít nhất 3 ngày và có SALE; nếu không: chưa đủ dữ liệu.
- Tính cả ngày không ghi nhận bán vào mẫu. Cần ghi nhận bán đầy đủ; không mô hình hóa mùa vụ, hết hàng làm mất doanh số, khuyến mãi, đơn đang giao.
- Hạn gần nhất áp dụng cả mặt hàng. Ngày đặt đã trễ sẽ hiện giao gấp, không ngầm cho rằng nhà cung cấp có thể giao ngay.
- 30 hàng [Mẫu] có lịch sử giả lập ngắn nên không chứng minh xu hướng cuối tuần. Không tạo thêm lịch sử giả để biến chúng thành xu hướng thực.
- Thời tiết đã bỏ theo yêu cầu. Không gọi API thời tiết.
- Không thay đổi schema SQL hay dữ liệu kinh doanh; không cần file SQL mới cho tính năng này.

Kiểm tra API và lỗi nhà cung cấp bằng mock trong tests/aiAdvisor.test.js; cần key thật để kiểm chứng gọi mô hình thực tế.
