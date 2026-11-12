const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrencyVnd(amount) {
  const num = Number(amount || 0);
  if (!Number.isFinite(num) || num <= 0) return '';
  return `${Math.round(num).toLocaleString('vi-VN')} ₫`;
}

async function deliverComplaintEmail({
  to,
  fromLabel,
  subject,
  text,
  html,
  logTitle,
  logDetails = [],
  fallbackFilename,
  config = {},
}) {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  console.log('====================================================');
  console.log(`[COMPLAINT EMAIL] ${logTitle}: ${to}`);
  logDetails.filter(Boolean).forEach((line) => console.log(line));
  console.log('====================================================');

  const gmailUser = ((config?.gmail && 'user' in config.gmail ? config.gmail.user : process.env.GMAIL_USER) || '').trim();
  const rawPass = (config?.gmail && 'appPassword' in config.gmail ? config.gmail.appPassword : process.env.GMAIL_APP_PASSWORD) || '';
  const gmailPass = rawPass.split('#')[0].replace(/\s+/g, '').trim();

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });
      await transporter.sendMail({
        from: `"${fromLabel}" <${gmailUser}>`,
        replyTo: gmailUser,
        to,
        subject,
        text,
        html,
      });
      console.log(`[COMPLAINT EMAIL GMAIL SUCCESS] Đã gửi thành công tới: ${to}`);
      return { sent: true, method: 'gmail', subject, to };
    } catch (err) {
      console.error('[COMPLAINT EMAIL GMAIL ERROR] Gửi qua Gmail thất bại:', err.message);
    }
  }

  try {
    const directory = path.join(__dirname, '..', '.local-mail');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, fallbackFilename),
      `To: ${to}\nSubject: ${subject}\n\n${text}`,
      'utf8',
    );
  } catch {}

  return { sent: false, method: 'console_or_local', subject, to };
}

async function sendComplaintNoticeEmail({
  to,
  supplierName,
  storeName,
  orderId,
  orderTotal,
  reasonLabel,
  description,
  itemSummaries,
  claimValue,
  resolutionProposal,
  evidenceImages = [],
  config = {},
}) {
  const safeSupplier = supplierName || 'Quý Chủ Vựa';
  const safeStore = storeName || 'Tiệm Tạp Hóa';
  const safeReason = reasonLabel || 'Hàng hư hỏng / bể vỡ khi nhận';
  const formattedTotal = formatCurrencyVnd(orderTotal);
  const subject = `[SupplyMind AI] Đơn hàng #${orderId} của bạn vừa bị khiếu nại`;

  const textLines = [
    `Kính gửi ${safeSupplier},`,
    '',
    `Đơn hàng #${orderId} của bạn vừa bị khiếu nại từ cửa hàng ${safeStore}.`,
    '',
    `THÔNG TIN ĐƠN HÀNG & LÝ DO KHIẾU NẠI:`,
    `- Mã đơn hàng: #${orderId}`,
    `- Cửa hàng khiếu nại: ${safeStore}`,
    formattedTotal ? `- Tổng giá trị đơn hàng: ${formattedTotal}` : '',
    `- Lý do khiếu nại: ${safeReason}`,
    itemSummaries ? `- Thông tin hàng bị hỏng / sự cố: ${itemSummaries}` : '',
    claimValue ? `- Ước tính thiệt hại: ${claimValue}` : '',
    resolutionProposal ? `- Phương án tiệm đề xuất: ${resolutionProposal}` : '',
    description ? `- Mô tả chi tiết từ tiệm: ${description}` : '',
    evidenceImages.length ? `- Hình ảnh bằng chứng đính kèm: ${evidenceImages.length} ảnh trên hệ thống` : '',
    '',
    `HƯỚNG DẪN KIỂM TRA & ĐỀ XUẤT GIẢI PHÁP:`,
    `1. Đăng nhập SupplyMind AI và vào mục "Đơn hàng từ cửa hàng".`,
    `2. Mở đơn hàng #${orderId} để xem toàn bộ thông tin tiệm tạp hóa đã điền kèm ảnh làm bằng chứng.`,
    `3. Chọn và gửi phương án giải quyết để hai bên thống nhất kết quả.`,
    '',
    `Trân trọng,`,
    `Đội ngũ SupplyMind AI`,
  ].filter(Boolean);

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #fed7aa; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #ea580c, #c2410c); padding: 22px 24px; color: #ffffff; text-align: center; }
        .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
        .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
        .badge { display: inline-block; background-color: #ffedd5; color: #9a3412; padding: 5px 12px; border-radius: 9999px; font-weight: 700; font-size: 13px; margin-bottom: 14px; }
        .info-box { background-color: #fffaf5; border: 1px solid #fed7aa; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
        .info-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .info-table td { padding: 4px 0; vertical-align: top; }
        .info-label { color: #64748b; width: 170px; font-weight: 500; }
        .info-val { color: #0f172a; font-weight: 600; }
        .desc-box { background-color: #f8fafc; border-left: 3px solid #ea580c; border-radius: 4px; padding: 10px 12px; margin-top: 10px; font-size: 13px; color: #334155; }
        .action-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px; margin-top: 16px; font-size: 13px; color: #166534; }
        .action-box ol { margin: 6px 0 0 18px; padding: 0; }
        .action-box li { margin-bottom: 4px; }
        .footer { padding: 16px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Đơn hàng #${orderId} của bạn vừa bị khiếu nại</h1>
          <p>Từ cửa hàng đối tác ${escapeHtml(safeStore)}</p>
        </div>
        <div class="content">
          <p>Kính gửi <strong>${escapeHtml(safeSupplier)}</strong>,</p>
          <p>Cửa hàng <strong>${escapeHtml(safeStore)}</strong> vừa gửi đơn khiếu nại cho đơn hàng <strong>#${orderId}</strong> trên hệ thống SupplyMind AI.</p>

          <div class="badge">Lý do khiếu nại: ${escapeHtml(safeReason)}</div>

          <div class="info-box">
            <table class="info-table">
              <tr><td class="info-label">Mã đơn hàng:</td><td class="info-val">#${orderId}</td></tr>
              ${formattedTotal ? `<tr><td class="info-label">Giá trị đơn hàng:</td><td class="info-val">${escapeHtml(formattedTotal)}</td></tr>` : ''}
              ${itemSummaries ? `<tr><td class="info-label">Thông tin hàng bị hỏng:</td><td class="info-val">${escapeHtml(itemSummaries)}</td></tr>` : ''}
              ${claimValue ? `<tr><td class="info-label">Ước tính thiệt hại:</td><td class="info-val" style="color: #dc2626;">${escapeHtml(claimValue)}</td></tr>` : ''}
              ${resolutionProposal ? `<tr><td class="info-label">Mong muốn từ tiệm:</td><td class="info-val" style="color: #0369a1;">${escapeHtml(resolutionProposal)}</td></tr>` : ''}
            </table>
            ${description ? `<div class="desc-box"><strong>Chi tiết tiệm ghi nhận:</strong><br>${escapeHtml(description)}</div>` : ''}
            ${evidenceImages.length ? `<p style="margin: 10px 0 0 0; font-size: 12.5px; color: #9a3412; font-weight: 600;">Đã đính kèm ${evidenceImages.length} ảnh chụp làm bằng chứng trên hệ thống.</p>` : ''}
          </div>

          <div class="action-box">
            <strong>Bước tiếp theo dành cho Chủ vựa:</strong>
            <ol>
              <li>Vào mục <strong>Đơn hàng từ cửa hàng</strong> trên SupplyMind AI và tìm đơn <strong>#${orderId}</strong>.</li>
              <li>Xem toàn bộ thông tin tiệm tạp hóa đã điền cùng <strong>hình ảnh bằng chứng</strong>.</li>
              <li>Chọn và gửi phương án giải quyết phù hợp để hai bên thống nhất.</li>
            </ol>
          </div>
        </div>
        <div class="footer">
          SupplyMind AI · Hệ thống kết nối Vựa Sỉ &amp; Tạp Hóa<br>
          Email thông báo tự động từ nền tảng
        </div>
      </div>
    </body>
    </html>
  `;

  return deliverComplaintEmail({
    to,
    fromLabel: 'SupplyMind AI - Thông báo khiếu nại',
    subject,
    text: textLines.join('\n'),
    html,
    logTitle: `Gửi thông báo đơn hàng bị khiếu nại tới Chủ vựa`,
    logDetails: [`Đơn hàng: #${orderId} | Cửa hàng: ${safeStore}`, `Lý do: ${safeReason}`],
    fallbackFilename: `${Date.now()}-complaint-notice-order-${orderId}-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`,
    config,
  });
}

async function sendComplaintResponseEmail({
  to,
  storeName,
  supplierName,
  orderId,
  orderTotal,
  reasonLabel,
  itemSummaries,
  actionLabel,
  deductAmount,
  supplierNote,
  config = {},
}) {
  const safeStore = storeName || 'Quý Tiệm Tạp Hóa';
  const safeSupplier = supplierName || 'Chủ vựa';
  const safeReason = reasonLabel || 'Khiếu nại đơn hàng';
  const formattedTotal = formatCurrencyVnd(orderTotal);
  const formattedDeduct = formatCurrencyVnd(deductAmount);
  const subject = `[SupplyMind AI] Bạn có một phản hồi về đơn khiếu nại #${orderId} mà bạn đã tạo`;

  const textLines = [
    `Kính gửi ${safeStore},`,
    '',
    `Bạn có một phản hồi mới từ ${safeSupplier} về đơn khiếu nại của đơn hàng #${orderId} mà bạn đã tạo.`,
    '',
    `THÔNG TIN ĐƠN HÀNG & PHẢN HỒI:`,
    `- Mã đơn hàng: #${orderId}`,
    `- Chủ vựa phản hồi: ${safeSupplier}`,
    formattedTotal ? `- Giá trị đơn hàng: ${formattedTotal}` : '',
    `- Lý do khiếu nại của bạn: ${safeReason}`,
    itemSummaries ? `- Mặt hàng liên quan: ${itemSummaries}` : '',
    `- Giải pháp Chủ vựa đề xuất: ${actionLabel || 'Trao đổi phương án xử lý'}${formattedDeduct ? ` (Giảm trừ ${formattedDeduct})` : ''}`,
    supplierNote ? `- Nội dung phản hồi từ Chủ vựa: ${supplierNote}` : '',
    '',
    `BƯỚC TIẾP THEO DÀNH CHO CỬA HÀNG:`,
    `1. Vui lòng đăng nhập SupplyMind AI và vào mục "Đơn mua hàng".`,
    `2. Mở đơn hàng #${orderId} để kiểm tra chi tiết giải pháp của Chủ vựa.`,
    `3. Bấm "Đồng ý phương án & Hoàn thành" nếu bạn thống nhất, hoặc chọn "Chưa đồng ý · Đề xuất lại" để trao đổi tiếp.`,
    '',
    `Trân trọng,`,
    `Đội ngũ SupplyMind AI`,
  ].filter(Boolean);

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 24px; }
        .card { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #bbf7d0; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #2d5a32, #166534); padding: 22px 24px; color: #ffffff; text-align: center; }
        .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
        .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.95; }
        .content { padding: 24px; font-size: 14px; line-height: 1.6; color: #334155; }
        .info-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
        .proposal-box { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px; margin: 12px 0; color: #14532d; }
        .info-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        .info-table td { padding: 4px 0; vertical-align: top; }
        .info-label { color: #64748b; width: 170px; font-weight: 500; }
        .info-val { color: #0f172a; font-weight: 600; }
        .action-box { background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px 16px; margin-top: 16px; font-size: 13px; color: #1e3a8a; }
        .action-box ol { margin: 6px 0 0 18px; padding: 0; }
        .action-box li { margin-bottom: 4px; }
        .footer { padding: 16px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Bạn có một phản hồi về đơn khiếu nại mà bạn đã tạo</h1>
          <p>Đơn hàng #${orderId} · Từ ${escapeHtml(safeSupplier)}</p>
        </div>
        <div class="content">
          <p>Kính gửi <strong>${escapeHtml(safeStore)}</strong>,</p>
          <p><strong>${escapeHtml(safeSupplier)}</strong> vừa gửi phản hồi và đề xuất phương án xử lý cho đơn khiếu nại của đơn hàng <strong>#${orderId}</strong>.</p>

          <div class="info-box">
            <table class="info-table">
              <tr><td class="info-label">Đơn hàng khiếu nại:</td><td class="info-val">#${orderId}</td></tr>
              ${formattedTotal ? `<tr><td class="info-label">Giá trị đơn hàng:</td><td class="info-val">${escapeHtml(formattedTotal)}</td></tr>` : ''}
              <tr><td class="info-label">Lý do bạn đã gửi:</td><td class="info-val">${escapeHtml(safeReason)}</td></tr>
              ${itemSummaries ? `<tr><td class="info-label">Mặt hàng liên quan:</td><td class="info-val">${escapeHtml(itemSummaries)}</td></tr>` : ''}
            </table>
          </div>

          <div class="proposal-box">
            <div style="font-weight: 700; margin-bottom: 6px;">Giải pháp Chủ vựa đề xuất:</div>
            <div style="font-size: 14.5px; font-weight: 700; color: #166534;">
              ${escapeHtml(actionLabel || 'Trao đổi phương án xử lý')}${formattedDeduct ? ` (-${escapeHtml(formattedDeduct)})` : ''}
            </div>
            ${supplierNote ? `<div style="margin-top: 8px; font-size: 13.5px; color: #1e293b;">Ghi chú: ${escapeHtml(supplierNote)}</div>` : ''}
          </div>

          <div class="action-box">
            <strong>Vui lòng kiểm tra và quyết định:</strong>
            <ol>
              <li>Vào mục <strong>Đơn mua hàng</strong> trên SupplyMind AI và tìm đơn <strong>#${orderId}</strong>.</li>
              <li>Kiểm tra chi tiết giải pháp mà Chủ vựa đã đề xuất.</li>
              <li>Chọn <strong>"Đồng ý phương án &amp; Hoàn thành"</strong> nếu thống nhất, hoặc chọn <strong>"Chưa đồng ý · Đề xuất lại"</strong> để thương lượng thêm.</li>
            </ol>
          </div>
        </div>
        <div class="footer">
          SupplyMind AI · Hệ thống kết nối Vựa Sỉ &amp; Tạp Hóa<br>
          Email thông báo tự động từ nền tảng
        </div>
      </div>
    </body>
    </html>
  `;

  return deliverComplaintEmail({
    to,
    fromLabel: 'SupplyMind AI - Phản hồi khiếu nại',
    subject,
    text: textLines.join('\n'),
    html,
    logTitle: `Gửi thông báo phản hồi khiếu nại tới Tiệm tạp hóa`,
    logDetails: [`Đơn hàng: #${orderId} | Chủ vựa: ${safeSupplier}`, `Phương án: ${actionLabel}`],
    fallbackFilename: `${Date.now()}-complaint-response-order-${orderId}-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`,
    config,
  });
}

module.exports = { sendComplaintNoticeEmail, sendComplaintResponseEmail };
