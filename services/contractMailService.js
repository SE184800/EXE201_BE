const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

async function sendPrivateKeyEmail({ to, user, contract, config = {} }) {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const rawPrivateKey = contract.rawPrivateKey;
  const contractNumber = contract.contractNumber;
  const userName = user.name || user.username || 'Quý đối tác';
  const roleCode = user.role?.code || user.role || 'STORE_OWNER';
  const roleName = roleCode === 'SUPPLIER' ? 'Chủ Vựa / Nhà Cung Cấp Sỉ' : 'Chủ Cửa Hàng Tạp Hóa';

  const subject = `[SupplyMind AI] Khóa bí mật (Private Key) và Thông tin Hợp đồng điện tử ${contractNumber}`;

  const text = [
    `Kính gửi Quý đối tác ${userName},`,
    '',
    `Chào mừng bạn đã đăng ký tài khoản thành công trên Nền tảng SupplyMind AI với vai trò: ${roleName}.`,
    '',
    `Căn cứ Luật Giao dịch điện tử số 20/2023/QH15, hệ thống SupplyMind AI đã khởi tạo Hợp đồng điện tử và cấp phát cặp khóa mã hóa bảo mật bất đối xứng Ed25519 dành riêng cho bạn.`,
    '',
    `THÔNG TIN HỢP ĐỒNG ĐIỆN TỬ:`,
    `- Số hợp đồng: ${contractNumber}`,
    `- Đơn vị nền tảng (Bên A): Nền tảng SupplyMind AI`,
    `- Đối tác liên kết (Bên B): ${userName} (@${user.username})`,
    '',
    `KHÓA BÍ MẬT CÁ NHÂN (PRIVATE KEY) DÙNG ĐỂ KÝ HỢP ĐỒNG:`,
    `${rawPrivateKey}`,
    '',
    `QUY TRÌNH KÝ KẾT HỢP ĐỒNG TRÊN SUPPLYMIND AI:`,
    `1. Đăng nhập vào nền tảng SupplyMind AI bằng tài khoản đã tạo.`,
    `2. Hoàn tất thông tin cơ sở kinh doanh tại bước Onboarding hoặc tại trang Cá nhân (Hồ sơ).`,
    `3. Khi hộp thoại Ký hợp đồng điện tử xuất hiện, đọc kỹ các điều khoản cam kết và tích chọn "Tôi đồng ý".`,
    `4. Sao chép chính xác chuỗi Khóa bí mật (Private Key) ở trên vào ô ký tên và nhấn "Xác nhận ký kết".`,
    `5. Sau khi ký thành công, hệ thống sẽ cấp chứng nhận con dấu điện tử độc nhất (Digital Stamp) vào văn bản hợp đồng. Bạn có thể xem và tải bản PDF bất cứ lúc nào.`,
    '',
    `LƯU Ý BẢO MẬT:`,
    `- Khóa bí mật (Private Key) tương đương chữ ký tay và con dấu cá nhân của bạn trên không gian số.`,
    `- Tuyệt đối không chia sẻ khóa bí mật này cho bất kỳ ai, kể cả nhân viên hỗ trợ của SupplyMind.`,
    '',
    `Trân trọng,`,
    `Ban Điều hành Nền tảng SupplyMind AI`,
    `Hotline: 1900 6868 · Email: contact@supplymind.vn`,
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #1e3a8a, #0284c7); padding: 28px 24px; color: #ffffff; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
        .contract-badge { display: inline-block; background-color: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 9999px; font-weight: 700; font-size: 13px; margin-bottom: 12px; }
        .key-title { font-weight: 700; color: #0f172a; margin-top: 14px; font-size: 13.5px; }
        .key-box { background-color: #0f172a; color: #38bdf8; padding: 16px; border-radius: 8px; font-family: 'Consolas', 'Courier New', monospace; font-size: 12.5px; word-break: break-all; margin: 10px 0 16px 0; border: 1px solid #1e293b; user-select: all; }
        .steps { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 16px 0; }
        .steps ol { margin: 8px 0 0 18px; padding: 0; }
        .steps li { margin-bottom: 6px; font-size: 13px; color: #166534; }
        .warning { background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; font-size: 13px; color: #991b1b; margin-top: 16px; }
        .footer { padding: 20px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>NỀN TẢNG SUPPLYMIND AI</h1>
          <p>Thỏa thuận dịch vụ & Khóa bảo mật ký kết điện tử Ed25519</p>
        </div>
        <div class="content">
          <p>Kính gửi Quý đối tác <strong>${userName}</strong>,</p>
          <p>Chào mừng bạn gia nhập mạng lưới liên kết chuỗi cung ứng <strong>SupplyMind AI</strong> với vai trò <strong>${roleName}</strong>.</p>
          
          <div class="contract-badge">Mã số hợp đồng: ${contractNumber}</div>
          
          <p>Căn cứ Luật Giao dịch điện tử số 20/2023/QH15, hệ thống đã khởi tạo Hợp đồng điện tử và cấp phát cặp khóa mã hóa bảo mật bất đối xứng chuẩn Ed25519 cho tài khoản của bạn. Dưới đây là <strong>Khóa bí mật cá nhân (Private Key)</strong> độc nhất của bạn dùng để ký tên xác nhận:</p>
          
          <div class="key-title">KHÓA BÍ MẬT CỦA BẠN (PRIVATE KEY):</div>
          <div class="key-box">
            ${rawPrivateKey}
          </div>
          
          <div class="steps">
            <strong style="color: #15803d; font-size: 14px;">Quy trình sử dụng Khóa bí mật để ký Hợp đồng:</strong>
            <ol>
              <li>Đăng nhập tài khoản trên nền tảng SupplyMind AI.</li>
              <li>Hoàn thành thông tin cơ sở kinh doanh (tên cơ sở, địa chỉ, mã số thuế).</li>
              <li>Đọc kỹ thỏa thuận điều khoản và tích chọn "Tôi đồng ý với các điều khoản".</li>
              <li>Sao chép và dán chuỗi <strong>Khóa bí mật (Private Key)</strong> ở trên vào ô ký tên.</li>
              <li>Nhấn <strong>"Xác nhận ký kết"</strong> để hệ thống đóng con dấu điện tử chứng thực.</li>
            </ol>
          </div>

          <div class="warning">
            <strong>Cảnh báo an toàn:</strong> Khóa bí mật này có giá trị pháp lý tương đương chữ ký tay và con dấu của bạn trên nền tảng. Vui lòng lưu trữ cẩn thận trong ghi chú an toàn, không gửi hay chia sẻ cho bất kỳ ai.
          </div>
        </div>
        <div class="footer">
          Nền tảng SupplyMind AI · contact@supplymind.vn · Hotline: 1900 6868<br>
          Khu Công nghệ cao, Phường Tân Phú, TP. Thủ Đức, TP. Hồ Chí Minh
        </div>
      </div>
    </body>
    </html>
  `;

  console.log('====================================================');
  console.log(`[CONTRACT KEY EMAIL] Gửi Private Key tới ${to}`);
  console.log(`Số hợp đồng: ${contractNumber}`);
  console.log(`Khóa bí mật (Private Key): ${rawPrivateKey}`);
  console.log('====================================================');

  const gmailUser = (config?.gmail?.user || process.env.GMAIL_USER || '').trim();
  const rawPass = (config?.gmail?.appPassword || process.env.GMAIL_APP_PASSWORD || '');
  const gmailPass = rawPass.split('#')[0].replace(/\s+/g, '').trim();

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
              });
      await transporter.sendMail({
        from: `"SupplyMind AI" <${gmailUser}>`,
        replyTo: gmailUser,
        to,
        subject,
        text,
        html,
      });
      console.log(`[CONTRACT EMAIL GMAIL SUCCESS] Đã gửi email Private Key thành công tới: ${to}`);
      return { sent: true, method: 'gmail' };
    } catch (err) {
      console.error('[CONTRACT EMAIL GMAIL ERROR] Gửi email qua Gmail thất bại:', err.message);
    }
  }

  if (config?.smtp?.host && config?.smtp?.from) {
    try {
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
      await transporter.sendMail({
        from: config.smtp.from,
        to,
        subject,
        text,
        html,
      });
      console.log(`[CONTRACT EMAIL SMTP SUCCESS] Đã gửi email Private Key thành công tới: ${to}`);
      return { sent: true, method: 'smtp' };
    } catch (err) {
      console.error('[CONTRACT EMAIL SMTP ERROR] Gửi email qua SMTP thất bại:', err.message);
    }
  }

  // Fallback to local .local-mail directory
  try {
    const directory = path.join(__dirname, '..', '.local-mail');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `${Date.now()}-privatekey-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`),
      `To: ${to}\nSubject: ${subject}\n\n${text}`,
      'utf8'
    );
  } catch {}

  return { sent: false, method: 'console_or_local' };
}

module.exports = { sendPrivateKeyEmail };
