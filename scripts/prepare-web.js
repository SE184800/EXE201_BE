const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const frontendCandidates = process.env.FRONTEND_DIR
  ? [path.resolve(root, process.env.FRONTEND_DIR)]
  : [path.resolve(root, '../EXE201_FE'), path.resolve(root, '../../FE/EXE201_FE')];
const frontend = frontendCandidates.find(directory => fs.existsSync(path.join(directory, 'package.json')));
const npmCli = process.env.npm_execpath;
if (!npmCli || !frontend) throw new Error('Chạy npm run deploy:prepare trong BE; đặt EXE201_FE cạnh EXE201_BE hoặc cấu hình FRONTEND_DIR trỏ đến thư mục FE.');
async function main() {
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [npmCli, 'run', 'build'], {
      cwd: frontend,
      env: { ...process.env, VITE_API_URL: '/api' },
      stdio: 'inherit',
      windowsHide: true,
    });
    build.once('error', reject);
    build.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`FE build thất bại (${signal || code}); chưa cập nhật BE/public.`));
    });
  });
  const destination = path.join(root, 'public');
  // Keep old hashed assets so an already-open page survives a redeploy.
  fs.mkdirSync(destination, { recursive: true });
  await fs.promises.cp(path.join(frontend, 'dist'), destination, { recursive: true });
  console.log('Đã đóng gói FE vào BE/public. Commit code BE và public cùng nhau để cập nhật bản online. Không chứa .env.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
