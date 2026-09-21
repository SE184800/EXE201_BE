function readConfig(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET phải có ít nhất 32 ký tự. Kiểm tra file .env.');
  }
  const origin = new URL(env.FRONTEND_URL || 'http://localhost:5173').origin;
  const allowedOrigins = [...new Set([origin, 'http://localhost:5173', 'http://127.0.0.1:5173'])];
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT không hợp lệ.');
  return {
    jwtSecret: env.JWT_SECRET,
    origin,
    allowedOrigins,
    port,
    production: env.NODE_ENV === 'production',
    sessionSeconds: 28800,
  };
}
module.exports = { readConfig };
