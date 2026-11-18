const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Format currency in VND
 */
function formatMoney(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
}

/**
 * Send an email to the store owner when an order completes the "Soạn hàng" (PREPARING) stage
 * and is dispatched/scheduled for delivery with estimated delivery time and driver details.
 */
async function sendOrderPackingCompletedEmail({
  order,
  buyer,
  recipientEmail,
  supplierProfile,
  driverInfo,
  config = {},
}) {
  const buyerName = buyer?.name || buyer?.username || order?.recipientName || 'Quý cửa hàng';
  const targetEmail = recipientEmail || buyer?.email || process.env.GMAIL_USER || '';

  if (!targetEmail || typeof targetEmail !== 'string') {
    console.warn('[ORDER DELIVERY EMAIL] Không có địa chỉ email người nhận.');
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const supplierName = supplierProfile?.businessName || 'Chủ Vựa Cung Ứng';
  const supplierAddress = supplierProfile?.warehouseAddress || 'Kho sỉ đối tác';
  const supplierPhone = supplierProfile?.phone || supplierProfile?.user?.phone || 'Đang cập nhật';

  const driverName = driverInfo?.driverName || 'Tài xế chuyên tuyến vựa';
  const driverPhone = driverInfo?.driverPhone || 'Đang cập nhật';
  const vehicleType = driverInfo?.vehicleType || 'Xe tải / Ba gác giao hàng';
  const licensePlate = driverInfo?.licensePlate ? ` (Biển số: ${driverInfo.licensePlate})` : '';
  const estimatedDeliveryTime =
    driverInfo?.estimatedDeliveryTime ||
    'Trong ngày (Vui lòng liên hệ tài xế/chủ vựa để thống nhất giờ cụ thể)';
  const deliveryNotes = driverInfo?.deliveryNotes || 'Hàng dễ vỡ, vui lòng kiểm đếm kỹ khi nhận hàng.';

  const deliveryAddress = order?.deliveryAddress || 'Địa chỉ tiệm tạp hóa đã đăng ký';
  const recipientPhone = order?.recipientPhone || buyer?.phone || '';
  const totalAmount = formatMoney(order?.total);

  const items = Array.isArray(order?.items) ? order.items : [];

  const subject = `[SupplyMind AI] Đơn hàng #${order.id} đã soạn xong · Dự kiến giao: ${estimatedDeliveryTime}`;

  // Plain-text version
  const text = [
    `Kính gửi Quý cửa hàng ${buyerName},`,
    '',
    `Chủ vựa "${supplierName}" đã hoàn tất kiểm đếm và đóng gói thành công đơn hàng #${order.id} của bạn trên Nền tảng SupplyMind AI.`,
    '',
    `======================================================`,
    `THỜI GIAN GIAO HÀNG DỰ KIẾN:`,
    `>> ${estimatedDeliveryTime} <<`,
    `======================================================`,
    '',
    `LƯU Ý QUAN TRỌNG:`,
    `Thời gian trên là lịch trình dự kiến xuất phát từ kho của chủ vựa. Quý tiệm vui lòng lưu ý để chủ động sắp xếp người nhận hàng, hoặc chủ động liên hệ với tài xế / chủ vựa để thương lượng, thống nhất thời gian giao - nhận phù hợp nhất.`,
    '',
    `THÔNG TIN TÀI XẾ & PHƯƠNG TIỆN:`,
    `- Tài xế phụ trách: ${driverName}`,
    `- Số điện thoại tài xế: ${driverPhone}`,
    `- Phương tiện vận chuyển: ${vehicleType}${licensePlate}`,
    `- Ghi chú từ chủ vựa: ${deliveryNotes}`,
    '',
    `THÔNG TIN CHỦ VỰA:`,
    `- Vựa cung ứng: ${supplierName}`,
    `- Địa chỉ kho sỉ: ${supplierAddress}`,
    `- Hotline liên hệ: ${supplierPhone}`,
    '',
    `ĐỊA CHỈ NHẬN HÀNG:`,
    `- Người nhận: ${buyerName} (${recipientPhone})`,
    `- Địa chỉ giao: ${deliveryAddress}`,
    '',
    `TỔNG GIÁ TRỊ ĐƠN HÀNG: ${totalAmount}`,
    '',
    `DANH SÁCH MẶT HÀNG ĐÃ SOẠN (${items.length} món):`,
    ...items.map(
      (it, idx) =>
        `${idx + 1}. ${it.productName} - ${it.quantity} × ${it.packaging} - Thành tiền: ${formatMoney(it.lineTotal)}`
    ),
    '',
    `Trân trọng,`,
    `Đội ngũ Hỗ trợ SupplyMind AI · Hotline: 1900 6868`,
  ].join('\n');

  // HTML email version
  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
        .container { max-width: 620px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #15803d 0%, #166534 100%); padding: 24px 28px; color: #ffffff; text-align: left; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
        .header p { margin: 6px 0 0; font-size: 13.5px; opacity: 0.92; }
        .content { padding: 24px 28px; }
        .alert-eta { background: #f0fdf4; border: 2px solid #86efac; border-radius: 10px; padding: 16px 20px; margin-bottom: 22px; }
        .alert-eta h3 { margin: 0 0 6px; color: #166534; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
        .eta-time { font-size: 19px; font-weight: 800; color: #15803d; margin: 4px 0 10px; }
        .eta-tip { font-size: 13px; color: #14532d; line-height: 1.55; margin: 0; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13.5px; }
        .card-title { font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
        .card-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .card-row:last-child { margin-bottom: 0; }
        .label { color: #64748b; }
        .value { color: #0f172a; font-weight: 600; text-align: right; }
        .driver-highlight { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin-bottom: 16px; font-size: 13.5px; }
        .table-wrap { margin-top: 18px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f8fafc; color: #475569; font-weight: 650; text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
        tr:last-child td { border-bottom: none; }
        .total-row { background: #fcfdfd; font-weight: 700; color: #0f172a; font-size: 14px; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; text-align: center; color: #64748b; font-size: 12px; line-height: 1.5; }
        .btn-call { display: inline-block; background: #059669; color: #ffffff !important; padding: 6px 14px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 12.5px; margin-left: 6px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 Đơn hàng #${order.id} đã hoàn tất Soạn hàng</h1>
          <p>Chủ vựa <strong>${supplierName}</strong> đã đóng gói đủ hàng và chuẩn bị vận chuyển đến bạn.</p>
        </div>

        <div class="content">
          <p style="margin-top: 0; font-size: 14px; line-height: 1.5;">
            Kính gửi <strong>${buyerName}</strong>,
          </p>

          <!-- KHỐI DỰ KIẾN GIAO HÀNG & THƯƠNG LƯỢNG THỜI GIAN -->
          <div class="alert-eta">
            <h3>⏰ Thời gian giao hàng dự kiến đến tiệm</h3>
            <div class="eta-time">🚚 ${estimatedDeliveryTime}</div>
            <p class="eta-tip">
              💡 <strong>Lưu ý quan trọng:</strong> Thời gian trên là lịch trình dự kiến từ chủ vựa. Quý cửa hàng vui lòng lưu ý để chủ động sắp xếp người nhận hàng, hoặc bấm gọi tài xế/chủ vựa bên dưới để <strong>thương lượng và thống nhất khung giờ nhận hàng</strong> thuận tiện nhất cho bạn!
            </p>
          </div>

          <!-- THÔNG TIN TÀI XẾ & PHƯƠNG TIỆN -->
          <div class="driver-highlight">
            <div class="card-title" style="color: #1e40af;">
              🚚 Thông tin chuyến xe &amp; Tài xế giao hàng
            </div>
            <div class="card-row">
              <span class="label">Tài xế phụ trách:</span>
              <span class="value">${driverName}</span>
            </div>
            <div class="card-row">
              <span class="label">Số điện thoại liên hệ:</span>
              <span class="value">
                <strong style="color: #0369a1;">${driverPhone}</strong>
                ${driverPhone && driverPhone !== 'Đang cập nhật' ? `<a href="tel:${driverPhone}" class="btn-call">Gọi tài xế</a>` : ''}
              </span>
            </div>
            <div class="card-row">
              <span class="label">Phương tiện vận chuyển:</span>
              <span class="value">${vehicleType}${licensePlate}</span>
            </div>
            ${deliveryNotes ? `
            <div class="card-row" style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #bfdbfe;">
              <span class="label">Dặn dò của chủ vựa:</span>
              <span class="value" style="color: #475569; font-weight: 500;">${deliveryNotes}</span>
            </div>` : ''}
          </div>

          <!-- THÔNG TIN CHỦ VỰA -->
          <div class="card">
            <div class="card-title">🏬 Thông tin vựa cung ứng</div>
            <div class="card-row">
              <span class="label">Tên vựa:</span>
              <span class="value">${supplierName}</span>
            </div>
            <div class="card-row">
              <span class="label">Hotline vựa:</span>
              <span class="value">${supplierPhone}</span>
            </div>
            <div class="card-row">
              <span class="label">Địa chỉ kho xuất hàng:</span>
              <span class="value">${supplierAddress}</span>
            </div>
          </div>

          <!-- ĐỊA CHỈ NHẬN HÀNG -->
          <div class="card">
            <div class="card-title">📍 Địa chỉ nhận hàng tại tiệm</div>
            <div class="card-row">
              <span class="label">Người nhận:</span>
              <span class="value">${buyerName} (${recipientPhone})</span>
            </div>
            <div class="card-row">
              <span class="label">Địa chỉ giao:</span>
              <span class="value">${deliveryAddress}</span>
            </div>
          </div>

          <!-- BẢNG MẶT HÀNG ĐÃ SOẠN -->
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mặt hàng</th>
                  <th style="text-align: center;">Số lượng</th>
                  <th style="text-align: right;">Đơn giá</th>
                  <th style="text-align: right;">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (it) => `
                  <tr>
                    <td><strong>${it.productName}</strong></td>
                    <td style="text-align: center;">${it.quantity} × ${it.packaging}</td>
                    <td style="text-align: right;">${formatMoney(it.unitPrice)}</td>
                    <td style="text-align: right;"><strong>${formatMoney(it.lineTotal)}</strong></td>
                  </tr>
                `
                  )
                  .join('')}
                <tr class="total-row">
                  <td colspan="3" style="text-align: right; padding-top: 12px;">Tổng thanh toán:</td>
                  <td style="text-align: right; padding-top: 12px; color: #15803d; font-size: 15px;">
                    ${totalAmount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="footer">
          SupplyMind AI · Nền tảng B2B &amp; Quản trị Chuỗi cung ứng Tạp hóa<br>
          Hotline hỗ trợ 24/7: <strong>1900 6868</strong> · Email: contact@supplymind.vn<br>
          Email này được gửi tự động khi đơn hàng hoàn thành soạn hàng và xếp chuyến vận chuyển.
        </div>
      </div>
    </body>
    </html>
  `;

  console.log('====================================================');
  console.log(`[ORDER DELIVERY EMAIL] Gửi email soạn hàng thành công tới: ${targetEmail}`);
  console.log(`Đơn hàng #${order.id} · Dự kiến giao: ${estimatedDeliveryTime}`);
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
        from: `"SupplyMind AI - Vận chuyển đơn sỉ" <${gmailUser}>`,
        replyTo: gmailUser,
        to: targetEmail,
        subject,
        text,
        html,
      });
      console.log(`[ORDER DELIVERY EMAIL GMAIL SUCCESS] Đã gửi email thành công tới: ${targetEmail}`);
      return { sent: true, method: 'gmail', to: targetEmail, subject };
    } catch (err) {
      console.error(`[ORDER DELIVERY EMAIL GMAIL ERROR] Gửi qua Gmail thất bại:`, err.message);
    }
  }

  // Fallback to .local-mail for dev / testing / offline
  try {
    const mailDir = path.join(__dirname, '../.local-mail');
    await fs.mkdir(mailDir, { recursive: true });
    const fileName = `order-delivery-${order.id}-${Date.now()}.json`;
    await fs.writeFile(
      path.join(mailDir, fileName),
      JSON.stringify(
        { to: targetEmail, subject, text, html, createdAt: new Date().toISOString() },
        null,
        2
      ),
      'utf8'
    );
    console.log(`[ORDER DELIVERY EMAIL FALLBACK] Đã lưu email vào .local-mail/${fileName}`);
    return { sent: true, method: 'local_file', file: fileName, to: targetEmail, subject };
  } catch (err) {
    console.error('[ORDER DELIVERY EMAIL FALLBACK ERROR]', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = {
  sendOrderPackingCompletedEmail,
};
