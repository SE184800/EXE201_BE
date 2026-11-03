const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

async function sendComplaintNoticeEmail({
  to,
  supplierName,
  storeName,
  orderId,
  reasonLabel,
  description,
  itemSummaries,
  claimValue,
  resolutionProposal,
  evidenceImages = [],
  config = {},
}) {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const subject = `[SupplyMind AI] Báo cáo sự cố đơn hàng #${orderId} từ tiệm ${storeName || 'Tạp hóa'}`;

  const textLines = [
    `Kính gửi Quý nhà cung cấp ${supplierName || 'Chủ Vựa'},`,
    '',
    `Hệ thống SupplyMind AI xin thông báo: Tiệm tạp hóa ${storeName || 'Đối tác'} vừa gửi một báo cáo sự cố / khiếu nại liên quan đến đơn hàng #${orderId}.`,
    '',
    `THÔNG TIN CHI TIẾT SỰ CỐ:`,
    `- Mã đơn hàng: #${orderId}`,
    `- Phân loại sự cố: ${reasonLabel || 'Hàng hư hỏng / bể vỡ khi nhận'}`,
    itemSummaries ? `- Mặt hàng gặp sự cố: ${itemSummaries}` : '',
    claimValue ? `- Ước tính thiệt hại: ${claimValue}` : '',
    resolutionProposal ? `- Đề xuất xử lý từ tiệm: ${resolutionProposal}` : '',
    description ? `- Nội dung phản ánh: ${description}` : '',
    evidenceImages.length ? `- Số lượng ảnh bằng chứng đính kèm: ${evidenceImages.length} ảnh` : '',
    '',
    `HƯỚNG DẪN XỬ LÝ CHO CHỦ VỰA:`,
    `1. Đăng nhập vào nền tảng SupplyMind AI tại mục Quản lý Đơn hàng.`,
    `2. Tìm đơn #${orderId} và bấm vào nút "Tiếp nhận xử lý sự cố / Khiếu nại".`,
    `3. Xem ảnh bằng chứng chụp hàng thực tế từ cửa hàng và lựa chọn phương án:`,
    `   - Đồng ý giao bù hàng mới (Hệ thống sẽ tự động tạo đơn giao bù 0đ).`,
    `   - Đồng ý hoàn tiền / Khấu trừ cọc tương ứng.`,
    `   - Trao đổi trực tiếp với tiệm tạp hóa để thống nhất giải pháp.`,
    '',
    `Trân trọng,`,
    `Ban Vận hành & Chăm sóc Khách hàng SupplyMind AI`,
    `Hotline hỗ trợ: 1900 6868 · Email: hotro@supplymind.vn`,
  ].filter(Boolean);

  const text = textLines.join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #fed7aa; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #ea580c, #c2410c); padding: 24px; color: #ffffff; text-align: center; }
        .header h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
        .alert-badge { display: inline-block; background-color: #ffedd5; color: #9a3412; padding: 4px 12px; border-radius: 9999px; font-weight: 700; font-size: 13px; margin-bottom: 12px; }
        .info-box { background-color: #fffaf5; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px 16px; margin: 14px 0; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13.5px; }
        .info-label { color: #64748b; font-weight: 500; }
        .info-val { color: #0f172a; font-weight: 600; text-align: right; }
        .desc-box { background-color: #f1f5f9; border-radius: 6px; padding: 10px 12px; margin-top: 10px; font-size: 13px; color: #334155; font-style: italic; }
        .action-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; margin-top: 16px; font-size: 13px; color: #166534; }
        .action-box ol { margin: 6px 0 0 18px; padding: 0; }
        .action-box li { margin-bottom: 4px; }
        .footer { padding: 18px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>THÔNG BÁO SỰ CỐ ĐƠN HÀNG #${orderId}</h1>
          <p>Yêu cầu hỗ trợ xử lý khiếu nại từ tiệm tạp hóa đối tác</p>
        </div>
        <div class="content">
          <p>Kính gửi Quý đối tác <strong>${supplierName || 'Chủ Vựa'}</strong>,</p>
          <p>Tiệm tạp hóa <strong>${storeName || 'Cửa hàng'}</strong> vừa gửi thông báo sự cố về đơn hàng <strong>#${orderId}</strong> trên hệ thống SupplyMind AI.</p>
          
          <div class="alert-badge">Phân loại sự cố: ${reasonLabel || 'Hàng hư hỏng / Thiếu hàng'}</div>

          <div class="info-box">
            ${itemSummaries ? `<div class="info-row"><span class="info-label">Mặt hàng bị sự cố:</span><span class="info-val">${itemSummaries}</span></div>` : ''}
            ${claimValue ? `<div class="info-row"><span class="info-label">Ước tính thiệt hại:</span><span class="info-val" style="color: #dc2626;">${claimValue}</span></div>` : ''}
            ${resolutionProposal ? `<div class="info-row"><span class="info-label">Phương án tiệm đề xuất:</span><span class="info-val" style="color: #0369a1;">${resolutionProposal}</span></div>` : ''}
            ${description ? `<div class="desc-box">" ${description} "</div>` : ''}
            ${evidenceImages.length ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #9a3412;">Đã đính kèm ${evidenceImages.length} hình ảnh chụp thực tế.</p>` : ''}
          </div>

          <div class="action-box">
            <strong>Phương án xử lý khuyến nghị cho Chủ vựa:</strong>
            <ol>
              <li>Đăng nhập tài khoản Chủ Vựa trên SupplyMind AI, mở mục <strong>Quản lý Đơn hàng</strong>.</li>
              <li>Kiểm tra chi tiết báo cáo và bấm <strong>"Xử lý khiếu nại"</strong>.</li>
              <li>Bạn có thể chọn <strong>"Đồng ý giao bù hàng mới"</strong> (hệ thống sẽ tự động tạo đơn giao bù 0đ gửi đến tiệm) hoặc <strong>"Đồng ý hoàn tiền"</strong>.</li>
            </ol>
          </div>
        </div>
        <div class="footer">
          Nền tảng SupplyMind AI · hotro@supplymind.vn · Hotline: 1900 6868<br>
          Hệ thống kết nối chuỗi cung ứng Vựa Sỉ - Tạp Hóa thông minh
        </div>
      </div>
    </body>
    </html>
  `;

  console.log('====================================================');
  console.log(`[COMPLAINT EMAIL] Gửi thông báo sự cố tới Chủ vựa: ${to}`);
  console.log(`Đơn hàng: #${orderId} | Cửa hàng: ${storeName}`);
  console.log(`Phân loại: ${reasonLabel}`);
  console.log('====================================================');

  const gmailUser = (config?.gmail?.user || process.env.GMAIL_USER || '').trim();
  const rawPass = config?.gmail?.appPassword || process.env.GMAIL_APP_PASSWORD || '';
  const gmailPass = rawPass.split('#')[0].replace(/\s+/g, '').trim();

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });
      await transporter.sendMail({
        from: `"SupplyMind AI - Hỗ trợ sự cố" <${gmailUser}>`,
        replyTo: gmailUser,
        to,
        subject,
        text,
        html,
      });
      console.log(`[COMPLAINT EMAIL GMAIL SUCCESS] Đã gửi thông báo sự cố thành công tới: ${to}`);
      return { sent: true, method: 'gmail' };
    } catch (err) {
      console.error('[COMPLAINT EMAIL GMAIL ERROR] Gửi qua Gmail thất bại:', err.message);
    }
  }

  // Fallback to local .local-mail directory
  try {
    const directory = path.join(__dirname, '..', '.local-mail');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `${Date.now()}-complaint-order-${orderId}-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`),
      `To: ${to}\nSubject: ${subject}\n\n${text}`,
      'utf8'
    );
  } catch {}

  return { sent: false, method: 'console_or_local' };
}

module.exports = { sendComplaintNoticeEmail };
