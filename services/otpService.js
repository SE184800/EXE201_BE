const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');

// Generates a 6-digit numeric OTP string
function generateOtp() {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

// SHA-256 hash of the OTP for secure verification
function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
}

// Creates a signed JWT token valid for 60 seconds containing registration data and OTP hash
function createOtpToken(registrationData, otp, jwtSecret) {
  const otpHash = hashOtp(otp);
  return jwt.sign(
    {
      email: registrationData.email,
      username: registrationData.username,
      otpHash,
      registrationData,
    },
    jwtSecret,
    { expiresIn: '60s' }
  );
}

// Verifies the OTP token and returns registrationData if valid and not expired
function verifyOtpToken(otpToken, enteredOtp, jwtSecret) {
  if (!otpToken || typeof otpToken !== 'string') {
    const error = new Error('Phiên xác thực không hợp lệ. Vui lòng đăng ký lại.');
    error.code = 'OTP_INVALID_TOKEN';
    error.status = 400;
    throw error;
  }

  let decoded;
  try {
    decoded = jwt.verify(otpToken, jwtSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      const error = new Error('Mã OTP đã hết hạn sau 60 giây. Vui lòng bấm "Gửi lại OTP".');
      error.code = 'OTP_EXPIRED';
      error.status = 400;
      throw error;
    }
    const error = new Error('Phiên xác thực không hợp lệ. Vui lòng thử lại.');
    error.code = 'OTP_INVALID_TOKEN';
    error.status = 400;
    throw error;
  }

  const enteredHash = hashOtp(enteredOtp);
  if (enteredHash !== decoded.otpHash) {
    const error = new Error('Mã OTP không chính xác. Vui lòng kiểm tra lại.');
    error.code = 'OTP_MISMATCH';
    error.status = 400;
    throw error;
  }

  return decoded.registrationData;
}

// Sends the 6-digit OTP email with spam-filter-optimized headers and templates
async function sendOtpMail({ to, otp, config }) {
  // A clean, natural subject line without brackets or raw codes that trigger spam heuristics
  const subject = 'Mã xác thực tài khoản SupplyMind AI';

  const html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Mã xác thực tài khoản SupplyMind AI</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
    <tr>
      <td style="padding: 28px 32px; border-bottom: 1px solid #f1f5f9; text-align: center;">
        <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #166534; letter-spacing: -0.5px;">SupplyMind AI</h1>
        <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">Nền tảng Quản trị và Kết nối B2B</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px 32px 24px 32px;">
        <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">
          Xin chào,
        </p>
        <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #334155;">
          Bạn vừa yêu cầu đăng ký tài khoản trên nền tảng SupplyMind AI. Vui lòng sử dụng mã xác thực bên dưới để hoàn tất đăng ký:
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <div style="display: inline-block; background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 14px 32px;">
            <span style="font-family: Consolas, 'Courier New', monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #166534; margin-right: -8px;">${otp}</span>
          </div>
        </div>

        <p style="margin: 0 0 12px 0; font-size: 13.5px; line-height: 1.5; color: #64748b; text-align: center;">
          Mã xác thực có hiệu lực trong vòng <strong>60 giây</strong>. Vì sự an toàn của tài khoản, vui lòng không chia sẻ mã này với người khác.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px 24px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
          Nếu bạn không thực hiện yêu cầu này, bạn có thể an tâm bỏ qua email.<br>
          © 2026 SupplyMind AI Platform. Bảo lưu mọi quyền.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const text = `SupplyMind AI\n\nMã xác thực tài khoản của bạn là: ${otp}\n\nMã có hiệu lực trong vòng 60 giây. Vui lòng không chia sẻ mã này cho người khác.`;

  console.log('====================================================');
  console.log(`[OTP REGISTRATION] Mã xác thực gửi tới ${to}: >>> ${otp} <<< (Hạn 60s)`);
  console.log('====================================================');

  const gmailUser = (config?.gmail?.user || process.env.GMAIL_USER || '').trim();
  const gmailPass = (config?.gmail?.appPassword || process.env.GMAIL_APP_PASSWORD || '').trim().replace(/\s+/g, '');

  if (gmailUser && gmailPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: gmailUser,
          pass: gmailPass,
        },
      });

      await transporter.sendMail({
        from: `"SupplyMind AI" <${gmailUser}>`,
        replyTo: gmailUser,
        to,
        subject,
        text,
        html,
        headers: {
          'X-Priority': '3',
        },
      });
      console.log(`[OTP GMAIL SUCCESS] Đã gửi email OTP thành công qua Gmail tới: ${to}`);
      return { sent: true, method: 'gmail' };
    } catch (err) {
      console.error('[OTP GMAIL ERROR] Gửi email qua Gmail thất bại:', err.message);
      if (config?.production) throw err;
    }
  }

  if (config?.smtp?.host && config?.smtp?.from) {
    try {
      const smtp = config.smtp;
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      });

      await transporter.sendMail({
        from: smtp.from,
        replyTo: smtp.from,
        to,
        subject,
        text,
        html,
      });
      console.log(`[OTP SMTP SUCCESS] Đã gửi email OTP thành công qua SMTP tới: ${to}`);
      return { sent: true, method: 'smtp' };
    } catch (err) {
      console.error('[OTP SMTP ERROR] Gửi email qua SMTP thất bại:', err.message);
      if (config?.production) throw err;
    }
  }

  if (!config?.production) {
    try {
      const directory = path.join(__dirname, '..', '.local-mail');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        path.join(directory, `${Date.now()}-otp-${to.replace(/[^a-zA-Z0-9]/g, '_')}.txt`),
        `To: ${to}\nSubject: ${subject}\n\n${text}\n\nOTP: ${otp}`,
        'utf8'
      );
    } catch {
      // Ignore local file write errors
    }
  }

  return { sent: false, method: 'console_or_local' };
}

module.exports = {
  generateOtp,
  hashOtp,
  createOtpToken,
  verifyOtpToken,
  sendOtpMail,
};
