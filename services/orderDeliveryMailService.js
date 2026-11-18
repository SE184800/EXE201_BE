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
 * Common mail sending helper via Gmail or local file fallback
 */
async function sendDeliveryMailHelper({
  targetEmail,
  fromLabel = 'SupplyMind AI - Vận chuyển đơn sỉ',
  subject,
  text,
  html,
  fallbackPrefix = 'order-delivery',
  logMessage = '',
  config = {},
}) {
  if (!targetEmail || typeof targetEmail !== 'string') {
    console.warn('[DELIVERY MAIL] Không có địa chỉ email người nhận.');
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  if (logMessage) {
    console.log('====================================================');
    console.log(logMessage);
    console.log('====================================================');
  }

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
        from: `"${fromLabel}" <${gmailUser}>`,
        replyTo: gmailUser,
        to: targetEmail,
        subject,
        text,
        html,
      });
      console.log(`[DELIVERY MAIL GMAIL SUCCESS] Đã gửi email thành công tới: ${targetEmail}`);
      return { sent: true, method: 'gmail', to: targetEmail, subject };
    } catch (err) {
      console.error(`[DELIVERY MAIL GMAIL ERROR] Gửi qua Gmail thất bại:`, err.message);
    }
  }

  // Fallback to .local-mail for dev / testing / offline
  try {
    const mailDir = path.join(__dirname, '../.local-mail');
    await fs.mkdir(mailDir, { recursive: true });
    const fileName = `${fallbackPrefix}-${Date.now()}.json`;
    await fs.writeFile(
      path.join(mailDir, fileName),
      JSON.stringify(
        { to: targetEmail, subject, text, html, createdAt: new Date().toISOString() },
        null,
        2
      ),
      'utf8'
    );
    console.log(`[DELIVERY MAIL FALLBACK] Đã lưu email vào .local-mail/${fileName}`);
    return { sent: true, method: 'local_file', file: fileName, to: targetEmail, subject };
  } catch (err) {
    console.error('[DELIVERY MAIL FALLBACK ERROR]', err.message);
    return { sent: false, reason: err.message };
  }
}

/**
 * 1. Send an email to the store owner when an order completes the "Soạn hàng" (PREPARING) stage
 * and is dispatched/scheduled for delivery with estimated delivery time and driver details.
 * (Nội dung phần thương lượng thời gian đã được rút gọn súc tích).
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

  // Plain-text version (rút gọn phần thương lượng thời gian)
  const text = [
    `Kính gửi Quý cửa hàng ${buyerName},`,
    '',
    `Chủ vựa "${supplierName}" đã đóng gói xong đơn hàng #${order.id} của bạn trên SupplyMind AI.`,
    '',
    `DỰ KIẾN GIAO: ${estimatedDeliveryTime}`,
    `(Quý tiệm lưu ý nhận hàng, hoặc liên hệ tài xế/chủ vựa bên dưới nếu muốn đổi giờ giao).`,
    '',
    `THÔNG TIN TÀI XẾ & PHƯƠNG TIỆN:`,
    `- Tài xế: ${driverName} (${driverPhone})`,
    `- Phương tiện: ${vehicleType}${licensePlate}`,
    deliveryNotes ? `- Dặn dò: ${deliveryNotes}` : '',
    '',
    `THÔNG TIN VỰA:`,
    `- Vựa cung ứng: ${supplierName} (Hotline: ${supplierPhone})`,
    `- Địa chỉ kho: ${supplierAddress}`,
    '',
    `ĐỊA CHỈ NHẬN HÀNG:`,
    `- Người nhận: ${buyerName} (${recipientPhone})`,
    `- Địa chỉ giao: ${deliveryAddress}`,
    '',
    `TỔNG GIÁ TRỊ: ${totalAmount} (${items.length} món)`,
    ...items.map(
      (it, idx) =>
        `  ${idx + 1}. ${it.productName} - ${it.quantity} × ${it.packaging} - ${formatMoney(it.lineTotal)}`
    ),
    '',
    `Trân trọng,`,
    `SupplyMind AI · Hotline: 1900 6868`,
  ].filter(Boolean).join('\n');

  // HTML email version (rút gọn phần thương lượng thời gian)
  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: #f1f5f9; color: #1e293b; }
        .container { max-width: 620px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .header { background: linear-gradient(135deg, #15803d 0%, #166534 100%); padding: 22px 26px; color: #ffffff; text-align: left; }
        .header h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.3px; }
        .header p { margin: 5px 0 0; font-size: 13px; opacity: 0.92; }
        .content { padding: 22px 26px; }
        .alert-eta { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 13px 16px; margin-bottom: 18px; }
        .alert-eta-title { font-size: 12.5px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.4px; }
        .eta-time { font-size: 17px; font-weight: 800; color: #15803d; margin: 3px 0 5px; }
        .eta-tip { font-size: 12.5px; color: #15803d; line-height: 1.45; margin: 0; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 13px 16px; margin-bottom: 14px; font-size: 13px; }
        .card-title { font-weight: 700; color: #0f172a; margin-bottom: 8px; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
        .card-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .card-row:last-child { margin-bottom: 0; }
        .label { color: #64748b; }
        .value { color: #0f172a; font-weight: 600; text-align: right; }
        .driver-highlight { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 13px 16px; margin-bottom: 14px; font-size: 13px; }
        .table-wrap { margin-top: 16px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { background: #f8fafc; color: #475569; font-weight: 650; text-align: left; padding: 9px 11px; border-bottom: 1px solid #e2e8f0; }
        td { padding: 9px 11px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
        tr:last-child td { border-bottom: none; }
        .total-row { background: #fcfdfd; font-weight: 700; color: #0f172a; font-size: 13.5px; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; color: #64748b; font-size: 11.5px; line-height: 1.5; }
        .btn-call { display: inline-block; background: #059669; color: #ffffff !important; padding: 4px 10px; border-radius: 5px; text-decoration: none; font-weight: 600; font-size: 11.5px; margin-left: 6px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📦 Đơn hàng #${order.id} đã hoàn tất Soạn hàng</h1>
          <p>Chủ vựa <strong>${supplierName}</strong> đã đóng gói đủ hàng và chuẩn bị vận chuyển đến bạn.</p>
        </div>

        <div class="content">
          <p style="margin-top: 0; font-size: 13.5px; line-height: 1.5;">
            Kính gửi <strong>${buyerName}</strong>,
          </p>

          <!-- KHỐI DỰ KIẾN GIAO HÀNG & THƯƠNG LƯỢNG THỜI GIAN (RÚT GỌN) -->
          <div class="alert-eta">
            <div class="alert-eta-title">⏰ Dự kiến giao hàng</div>
            <div class="eta-time">🚚 ${estimatedDeliveryTime}</div>
            <p class="eta-tip">
              💡 <em>Quý tiệm lưu ý nhận hàng, hoặc gọi tài xế/chủ vựa bên dưới nếu muốn đổi giờ giao phù hợp hơn.</em>
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
            <div class="card-row" style="margin-top: 5px; padding-top: 5px; border-top: 1px dashed #bfdbfe;">
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
              <span class="label">Địa chỉ kho:</span>
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
                  <td colspan="3" style="text-align: right; padding-top: 10px;">Tổng thanh toán:</td>
                  <td style="text-align: right; padding-top: 10px; color: #15803d; font-size: 14.5px;">
                    ${totalAmount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="footer">
          SupplyMind AI · Nền tảng B2B &amp; Quản trị Chuỗi cung ứng Tạp hóa<br>
          Hotline: <strong>1900 6868</strong> · Email: contact@supplymind.vn
        </div>
      </div>
    </body>
    </html>
  `;

  return sendDeliveryMailHelper({
    targetEmail,
    fromLabel: 'SupplyMind AI - Vận chuyển đơn sỉ',
    subject,
    text,
    html,
    fallbackPrefix: `order-delivery-${order.id}`,
    logMessage: `[ORDER DELIVERY EMAIL] Gửi email soạn hàng thành công tới: ${targetEmail} · Đơn #${order.id}`,
    config,
  });
}

/**
 * 2. Send an email to the store owner when the supplier accepts or rejects a reschedule delivery request.
 */
async function sendDeliveryRescheduleEmail({
  order,
  buyer,
  recipientEmail,
  supplierProfile,
  action, // 'ACCEPT' | 'REJECT'
  requestedTime,
  oldTime,
  note = '',
  config = {},
}) {
  const buyerName = buyer?.name || buyer?.username || order?.recipientName || 'Quý cửa hàng';
  const targetEmail = recipientEmail || buyer?.email || process.env.GMAIL_USER || '';

  const supplierName = supplierProfile?.businessName || 'Chủ Vựa Cung Ứng';
  const isAccepted = action === 'ACCEPT';

  const subject = isAccepted
    ? `[SupplyMind AI] Đã xác nhận đổi giờ giao đơn hàng #${order.id} · ${requestedTime}`
    : `[SupplyMind AI] Phản hồi yêu cầu đổi giờ đơn hàng #${order.id}`;

  const text = [
    `Kính gửi Quý cửa hàng ${buyerName},`,
    '',
    isAccepted
      ? `Chủ vựa "${supplierName}" đã ĐỒNG Ý đổi thời gian giao hàng cho đơn #${order.id}.`
      : `Chủ vựa "${supplierName}" CHƯA THỂ thay đổi giờ giao theo đề nghị cho đơn #${order.id}.`,
    '',
    isAccepted
      ? `THỜI GIAN GIAO MỚI: ${requestedTime}`
      : `LỊCH GIAO HIỆN TẠI: ${oldTime || 'Theo lịch trình đã hẹn trước'}`,
    note ? `Lời nhắn từ chủ vựa: ${note}` : '',
    '',
    `Quý tiệm vui lòng lưu ý để chuẩn bị nhận hàng thuận lợi.`,
    '',
    `Trân trọng,`,
    `SupplyMind AI · Hotline: 1900 6868`,
  ].filter(Boolean).join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 20px; }
        .box { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .header { background: ${isAccepted ? '#15803d' : '#475569'}; padding: 20px 24px; color: #ffffff; }
        .header h2 { margin: 0; font-size: 18px; font-weight: 700; }
        .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
        .content { padding: 22px 24px; font-size: 13.5px; line-height: 1.6; }
        .time-badge { background: ${isAccepted ? '#f0fdf4' : '#f8fafc'}; border: 1px solid ${isAccepted ? '#86efac' : '#cbd5e1'}; border-radius: 8px; padding: 13px 16px; margin: 14px 0; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11.5px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="header">
          <h2>${isAccepted ? '✅ Xác nhận đổi giờ giao hàng' : 'ℹ️ Thông báo về lịch giao hàng'}</h2>
          <p>Đơn hàng #${order.id} · Chủ vựa: ${supplierName}</p>
        </div>
        <div class="content">
          <p style="margin-top: 0;">Kính gửi <strong>${buyerName}</strong>,</p>
          <p>
            ${isAccepted
              ? `Chủ vựa <strong>${supplierName}</strong> đã đồng ý đổi lịch giao hàng cho đơn <strong>#${order.id}</strong> theo đề xuất của bạn.`
              : `Chủ vựa <strong>${supplierName}</strong> chưa thể thu xếp giao theo giờ đề xuất cho đơn <strong>#${order.id}</strong>.`
            }
          </p>
          <div class="time-badge">
            <div style="font-size: 12px; font-weight: 700; color: ${isAccepted ? '#166534' : '#475569'}; text-transform: uppercase;">
              ${isAccepted ? '⏰ Thời gian giao mới' : '⏰ Lịch giao được giữ nguyên'}
            </div>
            <div style="font-size: 17px; font-weight: 800; color: ${isAccepted ? '#15803d' : '#0f172a'}; margin: 3px 0;">
              🚚 ${isAccepted ? requestedTime : (oldTime || 'Theo lịch trình đã hẹn trước')}
            </div>
            ${note ? `<div style="font-size: 12.5px; color: #475569; margin-top: 6px;"><strong>Lời nhắn:</strong> ${note}</div>` : ''}
          </div>
          <p style="font-size: 12.5px; color: #64748b; margin-bottom: 0;">
            Quý cửa hàng vui lòng lưu ý thời gian trên để chuẩn bị nhận hàng thuận tiện.
          </p>
        </div>
        <div class="footer">
          SupplyMind AI · Hotline: 1900 6868 · Hỗ trợ kết nối Chuỗi cung ứng Tạp hóa
        </div>
      </div>
    </body>
    </html>
  `;

  return sendDeliveryMailHelper({
    targetEmail,
    fromLabel: 'SupplyMind AI - Lịch giao hàng',
    subject,
    text,
    html,
    fallbackPrefix: `order-reschedule-${order.id}`,
    logMessage: `[RESCHEDULE EMAIL] Gửi phản hồi đổi giờ đơn #${order.id} (${action}) tới: ${targetEmail}`,
    config,
  });
}

/**
 * 3. Send an email to the store owner when the supplier reports a transit incident / damage / issue during delivery preparation.
 */
async function sendDeliveryIncidentEmail({
  order,
  buyer,
  recipientEmail,
  supplierProfile,
  incidentData,
  supplementaryOrder,
  config = {},
}) {
  const buyerName = buyer?.name || buyer?.username || order?.recipientName || 'Quý cửa hàng';
  const targetEmail = recipientEmail || buyer?.email || process.env.GMAIL_USER || '';

  const supplierName = supplierProfile?.businessName || 'Chủ Vựa Cung Ứng';
  const damageLabel = incidentData?.damageTypeLabel || incidentData?.damageType || 'Sự cố hàng hóa khi vận chuyển';
  const damagedItems = Array.isArray(incidentData?.damagedItems) ? incidentData.damagedItems : [];
  const action = incidentData?.action;
  const isReplace = action === 'REPLACE_0VND' || !action;

  const subject = `[SupplyMind AI] Thông báo sự cố hàng hóa đơn hàng #${order.id}`;

  const text = [
    `Kính gửi Quý cửa hàng ${buyerName},`,
    '',
    `Chủ vựa "${supplierName}" thông báo đơn hàng #${order.id} của bạn gặp sự cố trong quá trình chuẩn bị / vận chuyển:`,
    `- Loại sự cố: ${damageLabel}`,
    `- Mặt hàng bị ảnh hưởng: ${damagedItems.map((it) => `${it.productName} (x${it.quantity} ${it.packaging || ''})`).join(', ')}`,
    incidentData?.notes ? `- Ghi chú từ chủ vựa: ${incidentData.notes}` : '',
    '',
    `PHƯƠNG ÁN XỬ LÝ:`,
    isReplace && supplementaryOrder
      ? `Chủ vựa đã tự động tạo đơn giao bù 0đ #${supplementaryOrder.id} để bổ sung đủ hàng cho bạn sớm nhất.`
      : `Chủ vựa sẽ giảm trừ ${formatMoney(incidentData?.lossAmount || 0)} trực tiếp vào số tiền COD khi bạn nhận hàng.`,
    '',
    `SupplyMind AI cam kết quyền lợi đơn hàng của bạn luôn được đảm bảo đầy đủ.`,
    '',
    `Trân trọng,`,
    `SupplyMind AI · Hotline: 1900 6868`,
  ].filter(Boolean).join('\n');

  const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; color: #1e293b; margin: 0; padding: 20px; }
        .box { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #fed7aa; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .header { background: #ea580c; padding: 20px 24px; color: #ffffff; }
        .header h2 { margin: 0; font-size: 18px; font-weight: 700; }
        .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
        .content { padding: 22px 24px; font-size: 13.5px; line-height: 1.6; }
        .alert-box { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 13px 16px; margin: 14px 0; }
        .solution-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 13px 16px; margin: 14px 0; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11.5px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="box">
        <div class="header">
          <h2>⚠️ Thông báo sự cố hàng hóa khi vận chuyển</h2>
          <p>Đơn hàng #${order.id} · Chủ vựa: ${supplierName}</p>
        </div>
        <div class="content">
          <p style="margin-top: 0;">Kính gửi <strong>${buyerName}</strong>,</p>
          <p>Chủ vựa <strong>${supplierName}</strong> ghi nhận đơn hàng <strong>#${order.id}</strong> gặp sự cố phát sinh trong quá trình chuẩn bị / vận chuyển.</p>
          <div class="alert-box">
            <div style="font-weight: 700; color: #9a3412; margin-bottom: 5px;">Chi tiết: ${damageLabel}</div>
            <div style="font-size: 13px; color: #7c2d12;">
              <strong>Mặt hàng bị ảnh hưởng:</strong>
              <ul style="margin: 4px 0 0; padding-left: 18px;">
                ${damagedItems.map((it) => `<li>${it.productName}: ${it.quantity} ${it.packaging || ''}</li>`).join('')}
              </ul>
            </div>
            ${incidentData?.notes ? `<div style="margin-top: 8px; font-size: 12.5px; color: #9a3412;"><strong>Ghi chú:</strong> ${incidentData.notes}</div>` : ''}
          </div>
          <div class="solution-box">
            <div style="font-weight: 700; color: #166534; margin-bottom: 4px;">Phương án giải quyết từ chủ vựa:</div>
            <div style="font-size: 13.5px; color: #15803d; font-weight: 600;">
              ${isReplace && supplementaryOrder
                ? `🚚 Đã tạo đơn giao bù 0đ #${supplementaryOrder.id} để bổ sung đủ số lượng sớm nhất cho bạn.`
                : `💰 Giảm trừ ${formatMoney(incidentData?.lossAmount || 0)} trực tiếp vào số tiền COD khi nhận hàng.`
              }
            </div>
          </div>
          <p style="font-size: 12.5px; color: #64748b; margin-bottom: 0;">
            SupplyMind AI cam kết luôn đồng hành và bảo vệ tối đa quyền lợi của quý khách hàng.
          </p>
        </div>
        <div class="footer">
          SupplyMind AI · Hotline: 1900 6868 · Hỗ trợ kết nối Chuỗi cung ứng Tạp hóa
        </div>
      </div>
    </body>
    </html>
  `;

  return sendDeliveryMailHelper({
    targetEmail,
    fromLabel: 'SupplyMind AI - Sự cố giao hàng',
    subject,
    text,
    html,
    fallbackPrefix: `order-incident-${order.id}`,
    logMessage: `[INCIDENT EMAIL] Gửi thông báo sự cố đơn #${order.id} tới: ${targetEmail}`,
    config,
  });
}

module.exports = {
  sendOrderPackingCompletedEmail,
  sendDeliveryRescheduleEmail,
  sendDeliveryIncidentEmail,
};
