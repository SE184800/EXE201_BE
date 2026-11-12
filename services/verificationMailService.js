const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

async function sendVerificationApprovedEmail({ to, recipientName, roleLabel }) {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const roleText = roleLabel || 'Đối tác';
  const nameText = recipientName || 'Quý khách';
  const subject = `[SupplyMind AI] Đơn của bạn đã được xử lý`;

  const text = [
    `Kính gửi ${nameText},`,
    '',
    `Đơn của bạn đã được admin phê duyệt. Chào mừng đến nền tảng SupplyMind AI.`,
    '',
    `Hồ sơ đăng ký với vai trò "${roleText}" của bạn hiện đã chuyển sang trạng thái ĐÃ XÁC MINH.`,
    'Tài khoản của bạn đã được kích hoạt hoạt động đầy đủ trên nền tảng SupplyMind AI.',
    '',
    'Vui lòng đăng nhập vào hệ thống để bắt đầu sử dụng các dịch vụ.',
    '',
    'Trân trọng,',
    'Ban Quản trị SupplyMind AI'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
      <h2 style="color: #15803d; margin-top: 0;">Đơn của bạn đã được xử lý</h2>
      <p>Kính gửi <strong>${nameText}</strong>,</p>
      <div style="background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <strong style="color: #166534; font-size: 15px;">Đơn của bạn đã được admin phê duyệt. Chào mừng đến nền tảng SupplyMind AI.</strong>
        <p style="margin: 6px 0 0 0; color: #15803d;">
          Hồ sơ vai trò <strong>${roleText}</strong> của bạn đã đạt trạng thái <strong>Đã xác minh</strong>.
        </p>
      </div>
      <p style="color: #334155; line-height: 1.6;">
        Tài khoản của bạn đã được kích hoạt hoạt động đầy đủ trên nền tảng SupplyMind AI. Bạn có thể đăng nhập ngay để thực hiện các giao dịch và quản lý hoạt động.
      </p>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">
        Email này được gửi tự động từ hệ thống quản trị SupplyMind AI.
      </div>
    </div>
  `;

  return deliverEmail({ to, subject, text, html, logType: 'APPROVED' });
}

async function sendVerificationRejectedEmail({ to, recipientName, roleLabel, reason }) {
  if (!to || typeof to !== 'string') {
    return { sent: false, reason: 'NO_RECIPIENT' };
  }

  const roleText = roleLabel || 'Đối tác';
  const nameText = recipientName || 'Quý khách';
  const reasonText = reason || 'Thông tin chưa đầy đủ hoặc không hợp lệ';
  const subject = `[SupplyMind AI] Đơn của bạn đã được giải quyết`;

  const text = [
    `Kính gửi ${nameText},`,
    '',
    `Đơn của bạn đã bị từ chối.`,
    `Lý do: ${reasonText}`,
    '',
    `Hồ sơ đăng ký với vai trò "${roleText}" của bạn hiện đang ở trạng thái CẦN ĐIỀU CHỈNH.`,
    'Vui lòng đăng nhập vào hệ thống SupplyMind AI, vào mục Tổng quan hoặc Hồ sơ để cập nhật lại thông tin đăng ký.',
    '',
    'Trân trọng,',
    'Ban Quản trị SupplyMind AI'
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; background: #ffffff;">
      <h2 style="color: #b91c1c; margin-top: 0;">Đơn của bạn đã được giải quyết</h2>
      <p>Kính gửi <strong>${nameText}</strong>,</p>
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
        <strong style="color: #991b1b; font-size: 15px;">Đơn của bạn đã bị từ chối.</strong>
        <p style="margin: 6px 0 0 0; color: #b91c1c;">
          <strong>Lý do:</strong> ${reasonText}
        </p>
      </div>
      <p style="color: #334155; line-height: 1.6;">
        Hồ sơ vai trò <strong>${roleText}</strong> của bạn đã chuyển sang trạng thái <strong>Cần điều chỉnh</strong>.
        Vui lòng đăng nhập vào nền tảng SupplyMind AI và cập nhật lại thông tin đăng ký để Admin kiểm tra và duyệt lại.
      </p>
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px;">
        Email này được gửi tự động từ hệ thống quản trị SupplyMind AI.
      </div>
    </div>
  `;

  return deliverEmail({ to, subject, text, html, logType: 'REJECTED' });
}

async function deliverEmail({ to, subject, text, html, logType }) {
  const cleanSecret = (val) => String(val || '').split('#')[0].replace(/\s+/g, '').trim();
  const gmailUser = (process.env.GMAIL_USER || process.env.SMTP_USER || '').trim();
  const gmailPass = cleanSecret(
    process.env.GMAIL_APP_PASSWORD ||
      process.env.GMAIL_PASS ||
      process.env.SMTP_PASSWORD ||
      process.env.SMTP_PASS
  );

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });
      await transporter.sendMail({
        from: `"SupplyMind AI - Xác minh đối tác" <${gmailUser}>`,
        replyTo: gmailUser,
        to,
        subject,
        text,
        html,
      });
      console.log(`[VERIFICATION EMAIL SUCCESS] Đã gửi thông báo xác minh (${logType}) tới: ${to}`);
      return { sent: true, method: 'gmail', to, subject, text, html };
    } catch (err) {
      console.error(`[VERIFICATION EMAIL ERROR] Gửi qua Gmail thất bại:`, err.message);
    }
  }

  // Fallback to local .local-mail directory for dev / testing / no-creds
  try {
    const mailDir = path.join(__dirname, '../.local-mail');
    await fs.mkdir(mailDir, { recursive: true });
    const fileName = `verification-${logType.toLowerCase()}-${Date.now()}.json`;
    await fs.writeFile(
      path.join(mailDir, fileName),
      JSON.stringify({ to, subject, text, html, createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    console.log(`[VERIFICATION EMAIL FALLBACK] Đã lưu thông báo xác minh vào .local-mail/${fileName}`);
    return { sent: true, method: 'local_file', file: fileName, to, subject, text, html };
  } catch (err) {
    console.error('[VERIFICATION EMAIL FALLBACK ERROR]', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
};
