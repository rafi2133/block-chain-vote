import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Contract, JsonRpcProvider, parseUnits } from 'ethers';
import type { Deployment, Metadata } from '../shared/types.js';
import { demoAccounts } from '../shared/demo.js';
import { Store } from '../server/src/store.js';

const d: Deployment = JSON.parse(readFileSync(resolve('shared/deployments/31337.json'), 'utf8'));
const provider = new JsonRpcProvider('http://127.0.0.1:8545', 31337, { cacheTimeout: -1 });
provider.pollingInterval = 100;
if (Number((await provider.getNetwork()).chainId) !== 31337) throw new Error('Seed is restricted to the local Hardhat chain.');
const admin = await provider.getSigner(d.admin);
const voting = new Contract(d.contractAddress, d.abi, admin);
const token = new Contract(d.tokenAddress, d.tokenAbi, admin);
const store = new Store(resolve(process.env.DB_PATH ?? 'server/data/ballot.sqlite'));
try {
  if (Number(await voting.electionCount()) > 0) {
    console.log('Existing elections found; seed skipped.');
  } else {
    await provider.send('evm_setIntervalMining', [0]);
    const voters = demoAccounts.slice(1, 4).map((a, i) => ({ personId: `voter-0${i+1}`, address: a.address }));
    for (const voter of voters) await (await token.transfer(voter.address, parseUnits('100', d.tokenDecimals))).wait();
    async function cast(index: number, electionId: number, candidateId: number) {
      const voter = await provider.getSigner(demoAccounts[index]!.address);
      await (await token.connect(voter).getFunction('approve')(d.contractAddress, d.voteCost)).wait();
      await (await voting.connect(voter).getFunction('vote')(electionId, candidateId)).wait();
    }
    async function create(metadata: Metadata, duration: number) {
      const block = await provider.getBlock('latest');
      const startsAt = block!.timestamp + 15;
      const draft = store.saveDraft(d.deploymentId, d.admin, metadata, startsAt, startsAt+duration, voters);
      await (await voting.createElection(draft.candidateCount, draft.metadataHash, draft.startsAt, draft.endsAt)).wait();
      const id = Number(await voting.electionCount());
      await (await voting.setEligibility(id, draft.wallets, true)).wait();
      await (await voting.publishElection(id)).wait();
      await provider.send('evm_setNextBlockTimestamp', [draft.startsAt]); await provider.send('evm_mine', []);
      return { ...draft, electionId: id };
    }
    const past = await create({ title: 'Student representative', description: 'A completed demo election for the next student representative. Every eligible wallet received one vote.', candidates: [
      { name: 'Alex Morgan', description: 'Better academic support and open office hours.' },
      { name: 'Sam Rivera', description: 'More inclusive student events and activities.' },
      { name: 'Jordan Lee', description: 'Practical improvements to everyday campus life.' },
    ] }, 60);
    for (const [i, option] of [[1,0],[2,0],[3,1]]) {
      await cast(i!, past.electionId, option!);
    }
    await provider.send('evm_setNextBlockTimestamp', [past.endsAt]); await provider.send('evm_mine', []);
    const active = await create({ title: 'Campus improvement fund', description: 'Help decide where this semester’s campus improvement budget goes. Choose one project. Voting is public and each eligible wallet can vote once.', candidates: [
      { name: 'Study commons', description: 'A quiet, accessible study space with more power outlets and extended opening hours.' },
      { name: 'Bike shelter', description: 'Covered bicycle parking near the main entrance, with secure racks and better lighting.' },
    ] }, 24 * 3600);
    await cast(3, active.electionId, 1);
    console.log('Seeded one open election and one completed election. Voter 01 and Voter 02 can still vote in the open election.');
  }
  await provider.send('evm_setIntervalMining', [2000]);
} finally { store.close(); provider.destroy(); }
