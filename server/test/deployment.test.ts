import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ContractFactory, Interface, Wallet, type JsonRpcProvider } from 'ethers';
import { describeSepoliaDeployment, type VotingArtifact } from '../../shared/deployment.js';
import { SEPOLIA_CHAIN_ID, TOKEN_ABI, TOM_TOKEN_ADDRESS } from '../../shared/sepolia.js';
import { demoAccounts } from '../../shared/demo.js';

const artifact: VotingArtifact = JSON.parse(readFileSync(new URL('../../contracts/artifacts/contracts/Voting.sol/Voting.json', import.meta.url), 'utf8'));
const hash = `0x${'12'.repeat(32)}`;
async function fixture() {
  const admin = Wallet.createRandom().address, contract = Wallet.createRandom().address;
  const tokenInterface = new Interface(TOKEN_ABI), votingInterface = new Interface(artifact.abi);
  const state = { network: SEPOLIA_CHAIN_ID, latest: 101, blockHash: `0x${'34'.repeat(32)}`, voteCost: 10n ** 18n,
    tx: { from: admin, to: null as string | null, chainId: BigInt(SEPOLIA_CHAIN_ID), data: (await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(TOM_TOKEN_ADDRESS)).data! },
    receipt: { status: 1, contractAddress: contract, blockNumber: 100, blockHash: `0x${'34'.repeat(32)}` } };
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(state.network) }), getCode: async () => '0x60006000',
    getTransaction: async () => state.tx, getTransactionReceipt: async () => state.receipt,
    getBlockNumber: async () => state.latest, getBlock: async () => ({ hash: state.blockHash }),
    call: async (tx: { to: string; data: string }) => {
      if (tx.to.toLowerCase() === TOM_TOKEN_ADDRESS.toLowerCase()) {
        const parsed = tokenInterface.parseTransaction(tx)!;
        const values: Record<string, unknown[]> = { name: ['Tom Token'], symbol: ['TOM'], decimals: [18], burnFrom: [] };
        return tokenInterface.encodeFunctionResult(parsed.name, values[parsed.name]);
      }
      const parsed = votingInterface.parseTransaction(tx)!;
      const values: Record<string, unknown[]> = { admin: [admin], voteToken: [TOM_TOKEN_ADDRESS], voteCost: [state.voteCost] };
      return votingInterface.encodeFunctionResult(parsed.name, values[parsed.name]);
    },
  } as unknown as JsonRpcProvider;
  return { state, provider, admin, contract };
}

test('records only a confirmed Sepolia deployment of this bytecode using the existing TOM address', async () => {
  const f = await fixture();
  const d = await describeSepoliaDeployment(f.provider, artifact, hash);
  assert.equal(d.admin, f.admin); assert.equal(d.contractAddress, f.contract);
  assert.equal(d.tokenAddress, TOM_TOKEN_ADDRESS); assert.equal(d.tokenSymbol, 'TOM');
  assert.equal(d.voteCost, '1000000000000000000'); assert.equal(d.deploymentTransactionHash, hash);
});
test('rejects a transaction pointing at a different token', async () => {
  const f = await fixture();
  f.state.tx.data = (await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(Wallet.createRandom().address)).data!;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /bytecode or Tom Token/);
});
test('rejects unrelated bytecode even when it exposes similar getters', async () => {
  const f = await fixture(); f.state.tx.data = '0x60006000';
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /bytecode or Tom Token/);
});
test('rejects failed receipts and waits for two confirmations', async () => {
  const f = await fixture(); f.state.receipt.status = 0;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /successful contract deployment/);
  f.state.receipt.status = 1; f.state.latest = 100;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /two Sepolia confirmations/);
});
test('rejects reorged deployment receipts', async () => {
  const f = await fixture(); f.state.blockHash = `0x${'56'.repeat(32)}`;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /canonical chain/);
});
test('rejects other networks and public Hardhat deployment accounts', async () => {
  const f = await fixture(); f.state.network = 1;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /Sepolia/);
  f.state.network = SEPOLIA_CHAIN_ID; f.state.tx.from = demoAccounts[0]!.address;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /public Hardhat account/);
});
test('rejects a deployed contract with a different token cost', async () => {
  const f = await fixture(); f.state.voteCost = 2n * 10n ** 18n;
  await assert.rejects(describeSepoliaDeployment(f.provider, artifact, hash), /voting rules/);
});
