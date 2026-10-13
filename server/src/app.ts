import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { SiweMessage } from 'siwe';
import { getAddress, isAddress, ZeroAddress } from 'ethers';
import { z, ZodError } from 'zod';
import { demoAccounts } from '../../shared/demo.js';
import { Store, BindingConflict } from './store.js';
import { ChainService } from './chain.js';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const walletSchema = z.string().refine(v => isAddress(v) && v !== ZeroAddress, 'Invalid wallet address');
const draftSchema = z.object({
  title: z.string().trim().min(3).max(100), description: z.string().trim().max(1000),
  candidates: z.array(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(240) })).min(2).max(20),
  voters: z.array(z.object({ personId: z.string().trim().min(1).max(64), address: walletSchema })).min(1).max(100),
  startDelayMinutes: z.number().int().min(1).max(10080), durationHours: z.number().min(0.05).max(720),
});
const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_call', 'eth_getCode', 'eth_getLogs', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_estimateGas']);
const rpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.number(), z.string(), z.null()]), method: z.string(), params: z.array(z.unknown()).max(10).default([]) });

export function createApp(store: Store, chain: ChainService, origin: string, enableDemo: boolean) {
  const app = express();
  const d = chain.deployment;
  const demoEnabled = enableDemo && d.chainId === 31337;
  const url = new URL(origin);
  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: url.protocol === 'https:', path: '/', maxAge: 8 * 3600_000 };
  app.disable('x-powered-by');
  app.use('/api', helmet(), rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use(express.json({ limit: '256kb' }), cookieParser());
  function originGuard(req: Request, _res: Response, next: NextFunction) {
    if (req.headers.origin !== origin) return next(new HttpError(403, 'Request origin is not allowed.'));
    next();
  }
  function address(req: Request) { return store.session(req.cookies.ballot_session ?? '', d.deploymentId); }
  function adminGuard(req: Request, _res: Response, next: NextFunction) {
    const user = address(req);
    if (!user) return next(new HttpError(401, 'Sign in with your wallet first.'));
    if (user !== d.admin.toLowerCase()) return next(new HttpError(403, 'Only the election administrator can perform this action.'));
    next();
  }
  app.get('/api/config', (_req, res) => res.json({ ...d, demoEnabled, rpcPath: '/api/rpc', demoAccounts: demoEnabled ? demoAccounts : [] }));
  app.get('/api/health', async (_req, res) => {
    const block = await chain.latestBlock();
    const cursor = store.cursor(d.deploymentId);
    res.json({ status: 'ok', chainId: d.chainId, blockNumber: block.number, indexedBlock: cursor?.block_number ?? null, syncWarning: chain.lastSyncError });
  });
  app.post('/api/rpc', originGuard, async (req, res) => {
    const batch = Array.isArray(req.body);
    const calls = z.array(rpcSchema).min(1).max(20).parse(batch ? req.body : [req.body]);
    for (const call of calls) {
      if (!readMethods.has(call.method)) throw new HttpError(403, 'RPC method is not allowed.');
    }
    const response = await fetch(chain.rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch ? calls : calls[0]), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new HttpError(503, 'Chain RPC is temporarily unavailable.');
    res.json(await response.json());
  });
  app.post('/api/auth/nonce', originGuard, (req, res) => {
    const wallet = getAddress(z.object({ address: walletSchema }).parse(req.body).address);
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 300_000;
    const message = new SiweMessage({ domain: url.host, address: wallet, statement: 'Sign in to Ballot. This does not cast a vote.', uri: origin, version: '1', chainId: d.chainId, nonce, issuedAt: new Date().toISOString(), expirationTime: new Date(expiresAt).toISOString() }).prepareMessage();
    store.challenge(nonce, d.deploymentId, wallet, message, expiresAt);
    res.json({ message });
  });
  app.post('/api/auth/verify', originGuard, async (req, res) => {
    const body = z.object({ message: z.string().max(4000), signature: z.string().max(1000) }).parse(req.body);
    let siwe: SiweMessage;
    try { siwe = new SiweMessage(body.message); } catch { throw new HttpError(401, 'Invalid sign-in message.'); }
    const challenge = store.getChallenge(siwe.nonce);
    if (!challenge || challenge.message !== body.message || challenge.deployment_id !== d.deploymentId || Number(challenge.expires_at) <= Date.now() || siwe.chainId !== d.chainId || siwe.address.toLowerCase() !== challenge.address) {
      throw new HttpError(401, 'Login challenge expired, modified, or already used.');
    }
    try { await siwe.verify({ signature: body.signature, domain: url.host, nonce: siwe.nonce }); }
    catch { throw new HttpError(401, 'Wallet signature could not be verified.'); }
    const token = randomBytes(32).toString('hex');
    try { store.consumeChallenge(siwe.nonce, d.deploymentId, siwe.address, token); }
    catch { throw new HttpError(401, 'Login challenge expired or already used.'); }
    res.cookie('ballot_session', token, cookieOptions).json({ address: getAddress(siwe.address), isAdmin: siwe.address.toLowerCase() === d.admin.toLowerCase() });
  });
  app.get('/api/auth/me', (req, res) => {
    const user = address(req);
    res.json({ address: user ? getAddress(user) : null, isAdmin: user === d.admin.toLowerCase() });
  });
  app.post('/api/auth/logout', originGuard, (req, res) => {
    store.logout(req.cookies.ballot_session ?? '');
    res.clearCookie('ballot_session', { path: '/', sameSite: 'strict', secure: cookieOptions.secure }).json({ ok: true });
  });
  app.get('/api/elections', async (req, res) => {
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(50).default(50) }).parse(req.query);
    res.json(await chain.list(query.offset, query.limit));
  });
  app.get('/api/activity', (_req, res) => res.json({ events: store.activity(d.deploymentId), warning: chain.lastSyncError }));
  app.post('/api/admin/drafts', originGuard, adminGuard, async (req, res) => {
    const body = draftSchema.parse(req.body);
    if (new Set(body.candidates.map(c => c.name.toLowerCase())).size !== body.candidates.length) throw new HttpError(400, 'Candidate names must be distinct.');
    const block = await chain.latestBlock();
    const startsAt = block.timestamp + body.startDelayMinutes * 60;
    const endsAt = startsAt + Math.round(body.durationHours * 3600);
    const prepared = store.saveDraft(d.deploymentId, address(req)!, { title: body.title, description: body.description, candidates: body.candidates }, startsAt, endsAt, body.voters);
    res.status(201).json(prepared);
  });
  app.post('/api/admin/elections/:id/resume', originGuard, adminGuard, async (req, res) => {
    const id = z.coerce.number().int().min(1).parse(req.params.id);
    const [election] = await chain.contract.getElection(id);
    if (election.published) throw new HttpError(409, 'This election has already been published.');
    if (election.creator.toLowerCase() !== address(req)) throw new HttpError(403, 'Election owner mismatch.');
    const draft = store.preparedDraft(d.deploymentId, address(req)!, election.metadataHash);
    if (!draft) throw new HttpError(404, 'No matching election draft was found.');
    res.json(draft);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
    if (error instanceof ZodError) return void res.status(400).json({ error: 'Please check the request fields.', details: error.flatten() });
    if (error instanceof BindingConflict) return void res.status(409).json({ error: error.message });
    if (error instanceof SyntaxError) return void res.status(400).json({ error: 'Invalid JSON request.' });
    console.error('Request failed:', { name: error instanceof Error ? error.name : 'Unknown error', code: (error as { code?: string })?.code });
    res.status(503).json({ error: d.chainId === 11155111
      ? 'Unable to read Sepolia right now. The network RPC request failed. Retry shortly; your elections and votes remain on-chain.'
      : 'Request could not be completed. Check the local chain and try again.' });
  });
  return app;
}
