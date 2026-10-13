import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import type { Deployment, ElectionState, ElectionView, Metadata } from '../../shared/types.js';
import { Store } from './store.js';

const STATES: ElectionState[] = ['Draft', 'Scheduled', 'Active', 'Ended'];
export class ChainService {
  readonly provider: JsonRpcProvider;
  readonly contract: Contract;
  private syncing = false;
  lastSyncError: string | null = null;
  constructor(readonly deployment: Deployment, readonly rpcUrl: string, readonly store: Store) {
    // Public testnet endpoints can reject batches as the number of elections grows.
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: deployment.chainId === 31337 ? 10 : 1 });
    this.contract = new Contract(deployment.contractAddress, deployment.abi, this.provider);
  }
  async validateDeployment() {
    const network = await this.provider.getNetwork();
    if (Number(network.chainId) !== this.deployment.chainId) throw new Error('RPC chain ID does not match deployment.');
    const code = await this.provider.getCode(this.deployment.contractAddress);
    const block = await this.provider.getBlock(this.deployment.deploymentBlock);
    if (code === '0x' || keccak256(code) !== this.deployment.runtimeCodeHash || block?.hash !== this.deployment.deploymentBlockHash) {
      throw new Error('Deployment does not match the running chain. Restart with npm run dev after resetting the local chain.');
    }
    if ((await this.contract.admin()).toLowerCase() !== this.deployment.admin.toLowerCase()) throw new Error('Deployment administrator mismatch.');
    const d = this.deployment;
    const token = new Contract(d.tokenAddress, d.tokenAbi, this.provider);
    if ((await this.contract.voteToken()).toLowerCase() !== d.tokenAddress.toLowerCase()
      || (await this.contract.voteCost()).toString() !== d.voteCost
      || keccak256(await this.provider.getCode(d.tokenAddress)) !== d.tokenRuntimeCodeHash
      || Number(await token.decimals()) !== d.tokenDecimals || await token.symbol() !== d.tokenSymbol) {
      throw new Error('Voting Token configuration does not match the running chain.');
    }
  }
  async latestBlock() {
    const block = await this.provider.getBlock('latest');
    if (!block) throw new Error('Chain unavailable');
    return block;
  }
  async list(offset = 0, limit = 50) {
    const block = await this.latestBlock();
    const options = { blockTag: block.number };
    const total = Number(await this.contract.electionCount(options));
    const ids = Array.from({ length: Math.min(limit, Math.max(0, total-offset)) }, (_, i) => total-offset-i);
    const elections = await Promise.all(ids.map(async id => {
      const [[e, state], counts] = await Promise.all([this.contract.getElection(id, options), this.contract.getResults(id, options)]);
      const rawMetadata = this.store.getSnapshot(e.metadataHash);
      let metadata: Metadata | null = null;
      if (rawMetadata) metadata = JSON.parse(rawMetadata);
      const verified = !!rawMetadata && keccak256(toUtf8Bytes(rawMetadata)) === e.metadataHash && metadata?.candidates.length === Number(e.candidateCount);
      return {
        id, creator: e.creator, startsAt: Number(e.startsAt), endsAt: Number(e.endsAt),
        candidateCount: Number(e.candidateCount), metadataHash: e.metadataHash,
        published: e.published, eligibleVoterCount: Number(e.eligibleVoterCount), totalVotes: Number(e.totalVotes),
        counts: counts.map(Number), state: STATES[Number(state)]!, rawMetadata, metadata, verified,
        blockNumber: block.number, blockTimestamp: block.timestamp,
      } satisfies ElectionView;
    }));
    return { elections, total, blockNumber: block.number, blockTimestamp: block.timestamp };
  }
  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const d = this.deployment;
      const latest = await this.latestBlock();
      const target = latest.number - (d.chainId === 31337 ? 0 : 6);
      let cursor = this.store.cursor(d.deploymentId);
      if (cursor) {
        const old = await this.provider.getBlock(Number(cursor.block_number));
        if (target < Number(cursor.block_number) || old?.hash !== cursor.block_hash) {
          // Full replay is intentionally simple for this small demo; tally reads remain on-chain.
          this.store.clearEvents(d.deploymentId); cursor = undefined;
        }
      }
      let from = cursor ? Number(cursor.block_number) + 1 : d.deploymentBlock;
      while (from <= target) {
        const to = Math.min(from + 999, target);
        const logs = await this.provider.getLogs({ address: d.contractAddress, fromBlock: from, toBlock: to });
        const block = await this.provider.getBlock(to);
        if (!block?.hash) throw new Error('Could not confirm event range');
        // Verify all returned logs still belong to the canonical chain before advancing the cursor.
        const hashes = new Map<number, string | null>();
        for (const n of new Set(logs.map(log => log.blockNumber))) hashes.set(n, (await this.provider.getBlock(n))?.hash ?? null);
        if (logs.some(log => hashes.get(log.blockNumber) !== log.blockHash)) throw new Error('Chain reorganized during event scan');
        const events = logs.flatMap(log => {
          const parsed = this.contract.interface.parseLog(log);
          if (!parsed) return [];
          return [{ txHash: log.transactionHash, logIndex: log.index, blockNumber: log.blockNumber, blockHash: log.blockHash,
            name: parsed.name, args: JSON.stringify(parsed.args.toObject(), (_, v) => typeof v === 'bigint' ? v.toString() : v) }];
        });
        this.store.saveEvents(d.deploymentId, events, to, block.hash); from = to + 1;
      }
      this.lastSyncError = null;
    } catch { this.lastSyncError = 'Event synchronization is delayed. On-chain results remain authoritative.'; }
    finally { this.syncing = false; }
  }
  close() { this.provider.destroy(); }
}
