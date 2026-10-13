import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import type { Deployment, Metadata } from '../../shared/types.js';
import { createApp } from '../src/app.js';
import { Store, BindingConflict } from '../src/store.js';
import { ChainService } from '../src/chain.js';

const origin = 'http://localhost:5173';
async function setup(enableDemo = false, chainId = 31337) {
  const wallet = Wallet.createRandom();
  const store = new Store(':memory:');
  const deployment: Deployment = { deploymentId: 'test-deployment', chainId, contractAddress: Wallet.createRandom().address,
    admin: wallet.address, deploymentBlock: 1, deploymentBlockHash: '0x00', runtimeCodeHash: '0x00', abi: [], deployedAt: new Date().toISOString(),
    tokenAddress: Wallet.createRandom().address, tokenAbi: [], tokenRuntimeCodeHash: '0x00', tokenSymbol: 'VOTE', tokenDecimals: 18, voteCost: '1000000000000000000' };
  const chain = new ChainService(deployment, 'http://127.0.0.1:1', store);
  const app = createApp(store, chain, origin, enableDemo);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const info = server.address() as { port: number };
  const base = `http://127.0.0.1:${info.port}`;
  const request = (path: string, body?: unknown, cookie?: string, requestOrigin = origin) => fetch(base+path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(signer = wallet) {
    const challenge = await (await request('/api/auth/nonce', { address: signer.address })).json();
    return { message: challenge.message as string, signature: await signer.signMessage(challenge.message) };
  }
  async function close() { chain.close(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
  return { wallet, store, chain, request, login, close };
}

test('Sepolia read failures describe the testnet connection without exposing RPC credentials', async () => {
  const f = await setup(false, 11155111);
  f.chain.list = async () => { throw Object.assign(new Error('RPC failed at https://example.invalid/private-key'), { code: 'SERVER_ERROR' }); };
  try {
    const response = await f.request('/api/elections');
    const body = await response.json();
    assert.equal(response.status, 503); assert.match(body.error, /Sepolia/);
    assert.doesNotMatch(body.error, /local chain|private-key/);
  } finally { await f.close(); }
});

test('a valid SIWE signature creates an HttpOnly session; replay and logout invalidate access', async () => {
  const f = await setup();
  try {
    const credentials = await f.login();
    const response = await f.request('/api/auth/verify', credentials);
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0]!;
    const me = await (await f.request('/api/auth/me', undefined, cookie)).json();
    assert.equal(me.address, f.wallet.address); assert.equal(me.isAdmin, true);
    assert.equal((await f.request('/api/auth/verify', credentials)).status, 401);
    await f.request('/api/auth/logout', {}, cookie);
    assert.equal((await (await f.request('/api/auth/me', undefined, cookie)).json()).address, null);
  } finally { await f.close(); }
});
test('simultaneous replay of one nonce creates only one session', async () => {
  const f = await setup();
  try {
    const credentials = await f.login();
    const responses = await Promise.all([f.request('/api/auth/verify', credentials), f.request('/api/auth/verify', credentials)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
    assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM sessions').get()!.n, 1);
  } finally { await f.close(); }
});
test('rejects a wrong signature, a modified domain, and an expired nonce', async () => {
  const f = await setup();
  try {
    const credentials = await f.login();
    const stranger = Wallet.createRandom();
    assert.equal((await f.request('/api/auth/verify', { ...credentials, signature: await stranger.signMessage(credentials.message) })).status, 401);
    assert.equal((await f.request('/api/auth/verify', { ...credentials, message: credentials.message.replace('localhost:5173', 'attacker.example') })).status, 401);
    f.store.db.prepare('UPDATE challenges SET expires_at=0').run();
    assert.equal((await f.request('/api/auth/verify', credentials)).status, 401);
  } finally { await f.close(); }
});
test('protects admin writes and disallows unapproved origins and RPC mutation methods', async () => {
  const f = await setup();
  try {
    assert.equal((await f.request('/api/admin/drafts', {})).status, 401);
    assert.equal((await f.request('/api/auth/nonce', { address: f.wallet.address }, undefined, 'https://attacker.example')).status, 403);
    const stranger = Wallet.createRandom();
    const credentials = await f.login(stranger);
    const response = await f.request('/api/auth/verify', credentials);
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    assert.equal((await f.request('/api/admin/drafts', {}, cookie)).status, 403);
    for (const method of ['evm_setNextBlockTimestamp', 'eth_sendTransaction', 'eth_sendRawTransaction']) {
      assert.equal((await f.request('/api/rpc', { jsonrpc: '2.0', id: 1, method, params: [] })).status, 403);
    }
    assert.equal((await f.request('/api/auth/nonce', { address: 'not-a-wallet' })).status, 400);
  } finally { await f.close(); }
});
test('the RPC gateway rejects transaction submissions even with local demo references enabled', async () => {
  const f = await setup(true);
  try {
    assert.equal((await (await f.request('/api/config')).json()).demoEnabled, true);
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction']) {
      assert.equal((await f.request('/api/rpc', { jsonrpc: '2.0', id: 1, method, params: [] })).status, 403);
    }
  } finally { await f.close(); }
});
test('metadata snapshots are immutable and binding conflicts roll back atomically', () => {
  const store = new Store(':memory:');
  try {
    const metadata: Metadata = { title: 'A public election', description: 'Demo', candidates: [{ name: 'A', description: '' }, { name: 'B', description: '' }] };
    const admin = Wallet.createRandom().address, alice = Wallet.createRandom().address, bob = Wallet.createRandom().address;
    const draft = store.saveDraft('d', admin, metadata, 10, 20, [{ personId: 'alice', address: alice }]);
    assert.equal(keccak256(toUtf8Bytes(draft.rawMetadata)), draft.metadataHash);
    assert.equal(store.getSnapshot(draft.metadataHash), draft.rawMetadata);
    assert.throws(() => store.saveDraft('d', admin, metadata, 30, 40, [{ personId: 'bob', address: bob }, { personId: 'alice', address: bob }]), BindingConflict);
    assert.throws(() => store.saveDraft('d', admin, metadata, 30, 40, [{ personId: 'other-person', address: alice }]), BindingConflict);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM bindings').get()!.n, 1);
    store.saveDraft('d', admin, metadata, 30, 40, [{ personId: 'alice', address: alice }]);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM bindings').get()!.n, 1);
  } finally { store.close(); }
});
test('event replay is idempotent and cursor reset allows clean reconstruction', () => {
  const store = new Store(':memory:');
  try {
    const event = { txHash: '0x1', logIndex: 0, blockNumber: 5, blockHash: '0xa', name: 'VoteCast', args: '{"electionId":"1"}' };
    store.saveEvents('d', [event], 5, '0xa'); store.saveEvents('d', [event], 5, '0xa');
    assert.equal(store.activity('d').length, 1); assert.equal(store.cursor('d')!.block_number, 5);
    store.clearEvents('d'); assert.equal(store.activity('d').length, 0); assert.equal(store.cursor('d'), undefined);
    store.saveEvents('d', [{ ...event, blockHash: '0xb' }], 5, '0xb');
    assert.equal(store.activity('d').length, 1); assert.equal(store.cursor('d')!.block_hash, '0xb');
  } finally { store.close(); }
});
