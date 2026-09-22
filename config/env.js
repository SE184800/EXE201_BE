function readConfig(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET phải có ít nhất 32 ký tự. Kiểm tra file .env.');
  }
  const production = env.NODE_ENV === 'production';
  const mailTransport = env.MAIL_TRANSPORT || (env.SMTP_HOST ? 'smtp' : production ? 'disabled' : 'file');
  if (!['smtp', 'file', 'disabled'].includes(mailTransport) || (production && mailTransport === 'file')) throw new Error('Production chỉ dùng SMTP hoặc tắt khôi phục mật khẩu; không dùng hộp thư test.');
  const vercelUrl = env.VERCEL === '1' && (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL);
  const publicUrl = env.FRONTEND_URL || env.RENDER_EXTERNAL_URL || (vercelUrl && `https://${vercelUrl}`);
  if (production && !publicUrl) throw new Error('Production cần FRONTEND_URL hoặc RENDER_EXTERNAL_URL.');
  const parsedUrl = new URL(publicUrl || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || (production && parsedUrl.protocol !== 'https:')) throw new Error('Production cần địa chỉ HTTPS hợp lệ.');
  const origin = parsedUrl.origin;
  // Production must opt in to every browser origin. This is important when the
  // frontend and API are separate Vercel projects behind a rewrite.
  const configuredOrigins = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:')) {
        throw new Error('CORS_ORIGINS chỉ được chứa địa chỉ HTTP(S) hợp lệ.');
      }
      return url.origin;
    });
  const allowedOrigins = [
    ...new Set([
      origin,
      ...configuredOrigins,
      ...(production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
    ]),
  ];
  if (production && env.VERCEL === '1' && env.VERCEL_URL) {
    const deploymentOrigin = new URL(`https://${env.VERCEL_URL}`).origin;
    if (!allowedOrigins.includes(deploymentOrigin)) allowedOrigins.push(deploymentOrigin);
  }
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) throw new Error('TRUST_PROXY_HOPS phải từ 0 đến 3.');
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT không hợp lệ.');
  const aiProvider = env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'GEMINI' : 'OPENAI');
  if (!['GEMINI', 'OPENAI'].includes(aiProvider)) throw new Error('AI_PROVIDER phải là GEMINI hoặc OPENAI.');
  return {
    mailTransport,
    smtp: { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || '', pass: env.SMTP_PASSWORD || '', from: env.SMTP_FROM || '' },
    aiProvider,
    aiApiKey: (aiProvider === 'GEMINI' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY) || '',
    aiModel: (aiProvider === 'GEMINI' ? env.GEMINI_MODEL : env.OPENAI_MODEL) || '',
    jwtSecret: env.JWT_SECRET,
    origin,
    allowedOrigins,
    port,
    production,
    trustProxyHops,
    serveWeb: env.SERVE_WEB === 'true',
    sessionSeconds: 28800,
  };
}
module.exports = { readConfig };
