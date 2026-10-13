import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { JsonRpcProvider, isError } from 'ethers';
import { z } from 'zod';
import { describeSepoliaDeployment, inspectTomToken, type VotingArtifact } from '../../shared/deployment.js';
import { SEPOLIA_CHAIN_ID, SEPOLIA_PUBLIC_RPC, TOM_TOKEN_ADDRESS } from '../../shared/sepolia.js';
import type { Deployment } from '../../shared/types.js';
import { Store } from './store.js';
import { ChainService } from './chain.js';
import { createApp } from './app.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deploymentPath = resolve(root, 'shared/deployments/11155111.json');
const artifact: VotingArtifact = JSON.parse(readFileSync(resolve(root, 'contracts/artifacts/contracts/Voting.sol/Voting.json'), 'utf8'));
const rpcUrl = process.env.SEPOLIA_RPC_URL || SEPOLIA_PUBLIC_RPC;
const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5175';
const app = express();
app.disable('x-powered-by');
app.use(helmet(), rateLimit({ windowMs: 60000, limit: 600 }), express.json({ limit: '256kb' }));
let workspace: ReturnType<typeof createApp> | undefined;
let chain: ChainService | undefined;
let store: Store | undefined;
let installing = false;
async function activate(deployment: Deployment) {
  const nextStore = new Store(resolve(root, 'server/data/sepolia.sqlite'));
  const nextChain = new ChainService(deployment, rpcUrl, nextStore);
  try { await nextChain.validateDeployment(); }
  catch (error) { nextChain.close(); nextStore.close(); throw error; }
  chain = nextChain; store = nextStore; workspace = createApp(nextStore, nextChain, origin, false);
  void chain.sync();
}
if (existsSync(deploymentPath)) await activate(JSON.parse(readFileSync(deploymentPath, 'utf8')));
app.get('/api/sepolia/plan', async (_req, res) => {
  const token = await inspectTomToken(provider);
  res.json({ chainId: SEPOLIA_CHAIN_ID, tokenAddress: TOM_TOKEN_ADDRESS, ...token, abi: artifact.abi, bytecode: artifact.bytecode,
    publicRpcUrl: SEPOLIA_PUBLIC_RPC, existingTransactionHash: chain?.deployment.deploymentTransactionHash ?? null });
});
app.post('/api/sepolia/complete', async (req, res) => {
  if (req.headers.origin !== origin) return void res.status(403).json({ error: 'Request origin is not allowed.' });
  const hash = z.object({ transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).parse(req.body).transactionHash;
  if (chain) {
    if (hash.toLowerCase() !== chain.deployment.deploymentTransactionHash?.toLowerCase()) return void res.status(409).json({ error: 'A Sepolia deployment is already configured. It will not be replaced.' });
    return void res.json(chain.deployment);
  }
  if (installing) return void res.status(409).json({ error: 'Deployment verification is already in progress.' });
  installing = true;
  try {
    if (existsSync(deploymentPath)) {
      const saved: Deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
      if (saved.deploymentTransactionHash?.toLowerCase() !== hash.toLowerCase()) return void res.status(409).json({ error: 'A different Sepolia deployment is already saved.' });
      await activate(saved); return void res.json(saved);
    }
    const deployment = await describeSepoliaDeployment(provider, artifact, hash);
    mkdirSync(dirname(deploymentPath), { recursive: true });
    writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2), { flag: 'wx' });
    await activate(deployment);
    res.json(deployment);
  } finally { installing = false; }
});
app.get('/api/sepolia/status', (_req, res) => res.json({ ready: !!workspace, chainId: SEPOLIA_CHAIN_ID }));
app.use((req, res, next) => {
  if (workspace) return workspace(req, res, next);
  if (req.path.startsWith('/api/')) return void res.status(409).json({ error: 'Complete Sepolia deployment from the Sepolia setup page.' });
  next();
});
app.use(express.static(resolve(root, 'web/dist')));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(root, 'web/dist/index.html')));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const rpcFailure = ['SERVER_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'CALL_EXCEPTION', 'BAD_DATA', 'UNKNOWN_ERROR'].some(code => isError(error, code as Parameters<typeof isError>[1]));
  res.status(error instanceof z.ZodError ? 400 : 503).json({ error: error instanceof z.ZodError ? 'Enter a valid deployment transaction hash.'
    : rpcFailure ? 'Sepolia RPC verification failed. Retry shortly, or configure another RPC locally.'
    : error instanceof Error && !('code' in error) ? error.message : 'Sepolia is temporarily unavailable.' });
});
const port = Number(process.env.PORT ?? 3002);
const server = app.listen(port, '0.0.0.0', () => console.log(`Sepolia API: http://127.0.0.1:${port}`));
const timer = setInterval(() => void chain?.sync(), 15000);
function stop() { clearInterval(timer); server.close(); provider.destroy(); chain?.close(); store?.close(); process.exit(0); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
