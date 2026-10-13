import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Interface, Wallet } from 'ethers';
import type { Deployment } from '../../shared/types.js';
import { ChainService } from '../src/chain.js';
import { Store } from '../src/store.js';

test('loads multiple Sepolia elections through an RPC endpoint that rejects large batches', { timeout: 15000 }, async () => {
  const store = new Store(':memory:');
  const admin = Wallet.createRandom().address;
  const artifact = JSON.parse(readFileSync(new URL('../../contracts/artifacts/contracts/Voting.sol/Voting.json', import.meta.url), 'utf8'));
  const abi = new Interface(artifact.abi);
  const snapshots = [1, 2].map(id => store.snapshot({ title: `Election ${id}`, description: '', candidates: [{ name: 'A', description: '' }, { name: 'B', description: '' }] }));
  const observedBatchSizes: number[] = [];
  const blockHash = `0x${'11'.repeat(32)}`;
  const rpc = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const batch = Array.isArray(input), calls = batch ? input : [input];
    observedBatchSizes.push(calls.length);
    const output = calls.map((call: { id: number; method: string; params: any[] }) => {
      if (calls.length > 3) return { jsonrpc: '2.0', id: call.id, error: { code: 31, message: 'Batch of more than 3 requests is not allowed.' } };
      let result: unknown;
      if (call.method === 'eth_chainId') result = '0xaa36a7';
      else if (call.method === 'eth_getBlockByNumber') result = { hash: blockHash, parentHash: `0x${'22'.repeat(32)}`, number: '0x64', timestamp: '0x1000',
        nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: admin, extraData: '0x', transactions: [], baseFeePerGas: '0x1' };
      else if (call.method === 'eth_call') {
        const parsed = abi.parseTransaction(call.params[0])!;
        const id = parsed.args.length ? Number(parsed.args[0]) : 0;
        if (parsed.name === 'electionCount') result = abi.encodeFunctionResult(parsed.name, [2]);
        else if (parsed.name === 'getElection') result = abi.encodeFunctionResult(parsed.name, [[admin, 1000, 9000, 2, snapshots[id - 1]!.metadataHash, true, 2, id === 1 ? 1 : 0], 2]);
        else if (parsed.name === 'getResults') result = abi.encodeFunctionResult(parsed.name, [id === 1 ? [0, 1] : [0, 0]]);
        else throw new Error(`Unexpected contract read: ${parsed.name}`);
      } else throw new Error(`Unexpected RPC method: ${call.method}`);
      return { jsonrpc: '2.0', id: call.id, result };
    });
    res.writeHead(calls.length > 3 ? 500 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(batch ? output : output[0]));
  });
  rpc.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => rpc.once('listening', resolve));
  const port = (rpc.address() as { port: number }).port;
  const deployment: Deployment = { deploymentId: 'batch-regression', chainId: 11155111, contractAddress: Wallet.createRandom().address,
    admin, deploymentBlock: 1, deploymentBlockHash: blockHash, runtimeCodeHash: '0x00', abi: artifact.abi, deployedAt: new Date().toISOString(),
    tokenAddress: Wallet.createRandom().address, tokenAbi: [], tokenRuntimeCodeHash: '0x00', tokenSymbol: 'TOM', tokenDecimals: 18, voteCost: '1000000000000000000' };
  const chain = new ChainService(deployment, `http://127.0.0.1:${port}`, store);
  try {
    const list = await chain.list();
    assert.equal(list.total, 2); assert.deepEqual(list.elections.map(e => e.id), [2, 1]);
    assert.deepEqual(list.elections.map(e => e.counts), [[0, 0], [0, 1]]);
    assert.equal(list.elections[1]!.totalVotes, 1);
    assert.ok(list.elections.every(e => e.verified && e.published));
    assert.ok(Math.max(...observedBatchSizes) <= 3);
  } finally { chain.close(); store.close(); await new Promise<void>(resolve => rpc.close(() => resolve())); }
});
