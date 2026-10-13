import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (existsSync('.env.sepolia')) process.loadEnvFile('.env.sepolia');
const isWin = process.platform === 'win32';
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      if (isWin && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

function start(args) {
  const command = isWin ? 'cmd.exe' : 'npm';
  const commandArgs = isWin ? ['/d', '/s', '/c', 'npm', ...args] : args;
  const child = spawn(command, commandArgs, {
    cwd: root,
    env: process.env,
    detached: !isWin,
    stdio: 'inherit'
  });
  children.push(child);
  child.once('error', error => { console.error(error.message); stop(1); });
  return child;
}

async function free(port) {
  return new Promise(resolve => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
  });
}

async function ready(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('Sepolia service exited. Check the error above.');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await pause(500);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

try {
  let apiPort = Number(process.env.PORT ?? 3002);
  if (process.env.PORT && !await free(apiPort)) throw new Error(`Configured API port ${apiPort} is occupied.`);
  while (!await free(apiPort) && apiPort < 3020) apiPort++;
  if (!await free(apiPort)) throw new Error('No available Sepolia API port.');

  let webPort = Number(process.env.WEB_PORT ?? (process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).port : 5175));
  if (process.env.APP_ORIGIN && !await free(webPort)) throw new Error(`Configured frontend port ${webPort} is occupied.`);
  while (!await free(webPort) && webPort < 5190) webPort++;
  if (!await free(webPort)) throw new Error('No available Sepolia frontend port.');

  process.env.PORT = String(apiPort);
  process.env.WEB_PORT = String(webPort);
  process.env.APP_ORIGIN ??= `http://localhost:${webPort}`;

  console.log('Preparing the Sepolia voting contract…');
  const compile = start(['run', 'compile']);
  if (await new Promise(resolve => compile.once('exit', resolve)) !== 0) {
    throw new Error('Contract compilation failed.');
  }

  const api = start(['run', 'dev:sepolia', '--workspace', 'server']);
  await ready(`http://127.0.0.1:${apiPort}/api/sepolia/status`, api);

  const web = start(['run', 'dev', '--workspace', 'web']);
  await ready(`http://localhost:${webPort}`, web);

  console.log(`\nSepolia setup: ${process.env.APP_ORIGIN}/sepolia\nConnect your own MetaMask wallet, then confirm deployment. Each vote burns 1 TOM.\nPress Ctrl+C to stop these Sepolia services.`);

  for (const child of [api, web]) {
    child.once('exit', code => {
      if (!stopping) {
        console.error(`A Sepolia service exited (${code}).`);
        stop(1);
      }
    });
  }
} catch (error) {
  console.error(error.message);
  stop(1);
}