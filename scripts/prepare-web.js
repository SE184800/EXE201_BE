const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const frontend = path.resolve(root, '../../FE/EXE201_FE');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(path.join(frontend, 'package.json'))) throw new Error('Chạy npm run deploy:prepare trong BE; cần thư mục FE cạnh BE.');
const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], { cwd: frontend, env: { ...process.env, VITE_API_URL: '/api' }, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
const destination = path.join(root, 'public');
// Keep old hashed assets so an already-open page survives a redeploy.
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(frontend, 'dist'), destination, { recursive: true });
console.log('Đã đóng gói FE vào BE/public. Commit code BE và public cùng nhau để cập nhật bản online. Không chứa .env.');
