const { spawnSync } = require('node:child_process');

function commands(env) {
  const result = [['generate']];
  // Preview builds must never migrate the shared production database.
  if (env.VERCEL_ENV === 'production') {
    if (!env.DATABASE_URL) throw new Error('Production build requires DATABASE_URL.');
    result.push(['migrate', 'deploy']);
  }
  return result;
}

function main() {
  const plan = commands(process.env);
  for (const args of plan) {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], {
      stdio: 'inherit', env: process.env, windowsHide: true,
    });
    if (result.error || result.status !== 0) throw new Error('Prisma build step failed; deployment stopped.');
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { commands };
