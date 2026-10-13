import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;
mkdirSync('.local', { recursive: true });
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}
process.once('SIGINT', () => stop()); process.once('SIGTERM', () => stop());
function start(args, logFile) {
  const log = logFile ? createWriteStream(resolve(logFile), { flags: 'w' }) : undefined;
  const child = spawn(npm, args, {
    cwd: root,
    env: process.env,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
    stdio: log ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (log) { child.stdout.pipe(log); child.stderr.pipe(log); child.once('close', () => log.end()); }
  children.push(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  return child;
}
async function run(args) {
  const child = start(args);
  const code = await new Promise(resolve => child.once('exit', resolve));
  if (code !== 0) throw new Error(`npm ${args.join(' ')} failed`);
}
async function free(port) {
  return new Promise(resolve => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
  });
}
async function ready(check, child, label) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`${label} exited; check .local logs.`);
    try { if (await check()) return; } catch {}
    await pause(500);
  }
  throw new Error(`${label} did not become ready.`);
}
try {
  for (const port of [8545, Number(process.env.PORT ?? 3001)]) {
    if (!await free(port)) throw new Error(`Port ${port} is already occupied. Stop the existing process or use the documented manual startup.`);
  }
  let webPort = Number(process.env.WEB_PORT ?? (process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).port : 5173));
  if (process.env.APP_ORIGIN && !await free(webPort)) throw new Error(`Configured frontend port ${webPort} is occupied.`);
  while (!await free(webPort) && webPort < 5190) webPort++;
  if (!await free(webPort)) throw new Error('No available frontend port in the configured range.');
  process.env.WEB_PORT = String(webPort);
  process.env.APP_ORIGIN ??= `http://localhost:${webPort}`;
  console.log('Starting the local Hardhat chain…');
  const node = start(['run', 'chain'], '.local/chain.log');
  await ready(async () => {
    const response = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
    return (await response.json()).result === '0x7a69';
  }, node, 'Hardhat');
  await run(['run', 'deploy']); await run(['run', 'seed']);
  const api = start(['run', 'dev', '--workspace', 'server']);
  await ready(async () => (await fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/api/health`)).ok, api, 'API');
  const web = start(['run', 'dev', '--workspace', 'web']);
  await ready(async () => (await fetch(`http://127.0.0.1:${webPort}`)).ok, web, 'Vue');
  console.log(`\nBallot is ready: ${process.env.APP_ORIGIN}\nOpen MetaMask setup, import a local test account in MetaMask, and connect the extension. Press Ctrl+C to stop all services.`);
  for (const child of [node, api, web]) child.once('exit', code => { if (!stopping) { console.error(`A service exited (${code}).`); stop(1); } });
} catch (error) { console.error(error.message); stop(1); }
