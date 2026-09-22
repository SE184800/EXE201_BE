const nodemailer = require('nodemailer');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function createResetMailer(config) {
  if (config.sendResetMail) return config.sendResetMail;
  return async ({ to, url }) => {
    const text = `SupplyMind AI\n\nĐặt lại mật khẩu tại:\n${url}\n\nLiên kết dùng một lần, hết hạn sau 15 phút. Nếu không yêu cầu, bạn có thể bỏ qua thư này.`;
    if (!config.production && config.mailTransport === 'file') {
      const directory = path.join(__dirname, '..', '.local-mail');
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, `${Date.now()}-${randomUUID()}.txt`), `To: ${to}\nSubject: Đặt lại mật khẩu SupplyMind AI\n\n${text}`, { mode: 0o600 });
      return;
    }
    if (config.mailTransport !== 'smtp' || !config.smtp?.host || !config.smtp?.from) throw new Error('MAIL_UNAVAILABLE');
    const smtp = config.smtp;
    const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: true,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000, disableFileAccess: true, disableUrlAccess: true });
    await transport.sendMail({ from: smtp.from, to: { address: to, name: '' }, subject: 'Đặt lại mật khẩu SupplyMind AI', text });
  };
}
module.exports = { createResetMailer };
