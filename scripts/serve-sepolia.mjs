import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const envFile = existsSync('.env.production') ? '.env.production' : '.env.sepolia';
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.PORT ??= '3002';
process.env.APP_ORIGIN ??= `http://localhost:${process.env.PORT}`;
const origin = new URL(process.env.APP_ORIGIN);
if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== process.env.APP_ORIGIN) {
  throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or trailing slash.');
}
for (const path of ['web/dist/index.html', 'contracts/artifacts/contracts/Voting.sol/Voting.json']) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run npm run verify before starting the built application.`);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npm, ['run', 'start:sepolia', '--workspace', 'server'], {
  cwd: root,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
  detached: process.platform !== 'win32',
});
let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
console.log(`Built Sepolia application: ${process.env.APP_ORIGIN}/sepolia`);
console.log('Express serves both the built Vue application and its API.');
