function readConfig(env = process.env) {
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET phải có ít nhất 32 ký tự. Kiểm tra file .env.');
  }
  const production = env.NODE_ENV === 'production';
  const vercelUrl = env.VERCEL === '1' && (env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL);
  const publicUrl = env.FRONTEND_URL || env.RENDER_EXTERNAL_URL || (vercelUrl && `https://${vercelUrl}`);
  if (production && !publicUrl) throw new Error('Production cần FRONTEND_URL hoặc RENDER_EXTERNAL_URL.');
  const parsedUrl = new URL(publicUrl || 'http://localhost:5173');
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || (production && parsedUrl.protocol !== 'https:')) throw new Error('Production cần địa chỉ HTTPS hợp lệ.');
  const origin = parsedUrl.origin;
  const allowedOrigins = production ? [origin] : [...new Set([origin, 'http://localhost:5173', 'http://127.0.0.1:5173'])];
  // Trust only this deployment's platform-provided hostname, never arbitrary *.vercel.app.
  if (production && env.VERCEL === '1' && env.VERCEL_URL) {
    const deploymentOrigin = new URL(`https://${env.VERCEL_URL}`).origin;
    if (!allowedOrigins.includes(deploymentOrigin)) allowedOrigins.push(deploymentOrigin);
  }
  const trustProxyHops = Number(env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) throw new Error('TRUST_PROXY_HOPS phải từ 0 đến 3.');
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT không hợp lệ.');
  return {
    aiApiKey: env.OPENAI_API_KEY || '',
    aiModel: env.OPENAI_MODEL || '',
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
