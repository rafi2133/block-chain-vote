import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Deployment } from '../../shared/types.js';
import { Store } from './store.js';
import { ChainService } from './chain.js';
import { createApp } from './app.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const deploymentPath = resolve(projectRoot, process.env.DEPLOYMENT_FILE ?? 'shared/deployments/31337.json');
if (!existsSync(deploymentPath)) throw new Error('No deployment found. Start the application with npm run dev.');
const deployment: Deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
const store = new Store(resolve(projectRoot, process.env.DB_PATH ?? 'server/data/ballot.sqlite'));
const chain = new ChainService(deployment, process.env.RPC_URL ?? 'http://127.0.0.1:8545', store);
await chain.validateDeployment();
await chain.sync();
const app = createApp(store, chain, process.env.APP_ORIGIN ?? 'http://localhost:5173', process.env.DEMO_ENABLED !== 'false');
const staticRoot = resolve(projectRoot, 'web/dist');
if (existsSync(staticRoot)) {
  app.use(express.static(staticRoot));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(staticRoot, 'index.html')));
}
const server = app.listen(Number(process.env.PORT ?? 3001), '127.0.0.1', () => console.log('Ballot API: http://127.0.0.1:3001'));
const timer = setInterval(() => void chain.sync(), 3000);
function stop() {
  clearInterval(timer); server.close(); chain.close(); store.close();
  process.exit(0);
}
process.once('SIGTERM', stop); process.once('SIGINT', stop);
