import { expect } from 'chai';
import hre from 'hardhat';

async function base() {
  const { ethers, provider } = await hre.network.create();
  const [admin, alice, bob, outsider] = await ethers.getSigners();
  const token: any = await ethers.deployContract('VoteToken');
  const voting: any = await ethers.deployContract('Voting', [await token.getAddress()]);
  const unit = ethers.parseEther('1');
  const latest = await ethers.provider.getBlock('latest');
  const startsAt = latest!.timestamp + 100;
  const endsAt = startsAt + 1000;
  const metadataHash = ethers.id('student election metadata');
  async function time(timestamp: number) {
    await provider.request({ method: 'evm_setNextBlockTimestamp', params: [timestamp] });
    await provider.request({ method: 'evm_mine', params: [] });
  }
  return { ethers, provider, admin, alice, bob, outsider, token, voting, unit, startsAt, endsAt, metadataHash, time };
}

async function election(publish = true) {
  const f = await base();
  await f.voting.createElection(3, f.metadataHash, f.startsAt, f.endsAt);
  await f.voting.setEligibility(1, [f.alice.address, f.bob.address], true);
  for (const voter of [f.alice, f.bob]) {
    await f.token.transfer(voter.address, 3n * f.unit);
    await f.token.connect(voter).approve(await f.voting.getAddress(), f.unit);
  }
  if (publish) await f.voting.publishElection(1);
  return f;
}

describe('SC-01 createElection', () => {
  it('creates an administrator-owned draft with ID 1 and the exact initial fields', async () => {
    const f = await base();
    await expect(f.voting.createElection(3, f.metadataHash, f.startsAt, f.endsAt))
      .to.emit(f.voting, 'ElectionCreated').withArgs(1, f.admin.address, f.metadataHash);
    expect(await f.voting.electionCount()).to.equal(1n);
    const [draft, state] = await f.voting.getElection(1);
    expect(draft.creator).to.equal(f.admin.address);
    expect(draft.candidateCount).to.equal(3n);
    expect(draft.metadataHash).to.equal(f.metadataHash);
    expect(draft.startsAt).to.equal(BigInt(f.startsAt));
    expect(draft.endsAt).to.equal(BigInt(f.endsAt));
    expect(draft.published).to.equal(false);
    expect(draft.eligibleVoterCount).to.equal(0n);
    expect(draft.totalVotes).to.equal(0n);
    expect(state).to.equal(0n);
    await f.voting.createElection(2, f.metadataHash, f.startsAt, f.endsAt);
    expect(await f.voting.electionCount()).to.equal(2n);
  });
  it('rejects unauthorized callers and invalid configuration without allocating an ID', async () => {
    const f = await base();
    await expect(f.voting.connect(f.outsider).createElection(3, f.metadataHash, f.startsAt, f.endsAt))
      .to.be.revertedWithCustomError(f.voting, 'Unauthorized');
    for (const count of [1, 21]) await expect(f.voting.createElection(count, f.metadataHash, f.startsAt, f.endsAt))
      .to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.voting.createElection(3, f.ethers.ZeroHash, f.startsAt, f.endsAt))
      .to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.voting.createElection(3, f.metadataHash, 0, f.endsAt))
      .to.be.revertedWithCustomError(f.voting, 'InvalidTimeWindow');
    await expect(f.voting.createElection(3, f.metadataHash, f.endsAt, f.startsAt))
      .to.be.revertedWithCustomError(f.voting, 'InvalidTimeWindow');
    expect(await f.voting.electionCount()).to.equal(0n);
  });
});

describe('SC-02 vote (requires SC-01)', () => {
  it('counts one ballot, burns exactly one Token, consumes its approval and emits both events', async () => {
    const f = await election(); await f.time(f.startsAt);
    const supply = await f.token.totalSupply();
    await expect(f.voting.connect(f.alice).vote(1, 2))
      .to.emit(f.voting, 'VoteTokenBurned').withArgs(1, f.alice.address, f.unit)
      .and.to.emit(f.voting, 'VoteCast').withArgs(1, f.alice.address, 2)
      .and.to.emit(f.token, 'Transfer').withArgs(f.alice.address, f.ethers.ZeroAddress, f.unit);
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(true);
    expect(await f.voting.eligible(1, f.alice.address)).to.equal(true);
    expect(await f.voting.voteCounts(1, 2)).to.equal(1n);
    expect((await f.voting.getElection(1))[0].totalVotes).to.equal(1n);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(2n * f.unit);
    expect(await f.token.totalSupply()).to.equal(supply - f.unit);
    expect(await f.token.allowance(f.alice.address, await f.voting.getAddress())).to.equal(0n);
  });
  it('rejects a nonexistent election, unregistered wallet, invalid candidate and repeat vote', async () => {
    const f = await election(); await f.time(f.startsAt);
    await expect(f.voting.connect(f.alice).vote(999, 0)).to.be.revertedWithCustomError(f.voting, 'ElectionNotFound');
    await expect(f.voting.connect(f.outsider).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'NotEligible');
    await expect(f.voting.connect(f.alice).vote(1, 3)).to.be.revertedWithCustomError(f.voting, 'InvalidCandidate');
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    await f.voting.connect(f.alice).vote(1, 0);
    await expect(f.voting.connect(f.alice).vote(1, 1)).to.be.revertedWithCustomError(f.voting, 'AlreadyVoted');
    expect(await f.voting.voteCounts(1, 0)).to.equal(1n);
    expect(await f.voting.voteCounts(1, 1)).to.equal(0n);
  });
  it('rejects drafts, votes before the start, and votes exactly at the end', async () => {
    const f = await election(false);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'NotPublished');
    await f.voting.publishElection(1);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'VotingNotOpen');
    await f.time(f.endsAt);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'VotingNotOpen');
  });
  it('rolls back every voting write when Token allowance is missing', async () => {
    const f = await election(); await f.time(f.startsAt);
    await f.token.connect(f.alice).approve(await f.voting.getAddress(), 0);
    const balance = await f.token.balanceOf(f.alice.address);
    const supply = await f.token.totalSupply();
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientAllowance');
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    expect(await f.voting.voteCounts(1, 0)).to.equal(0n);
    expect((await f.voting.getElection(1))[0].totalVotes).to.equal(0n);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(balance);
    expect(await f.token.totalSupply()).to.equal(supply);
  });
  it('rolls back Token allowance and voting writes when the Token balance is insufficient', async () => {
    const f = await election(); await f.time(f.startsAt);
    await f.token.connect(f.alice).transfer(f.bob.address, 3n * f.unit);
    const supply = await f.token.totalSupply();
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientBalance');
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    expect(await f.voting.voteCounts(1, 0)).to.equal(0n);
    expect((await f.voting.getElection(1))[0].totalVotes).to.equal(0n);
    expect(await f.token.allowance(f.alice.address, await f.voting.getAddress())).to.equal(f.unit);
    expect(await f.token.totalSupply()).to.equal(supply);
  });
});

describe('SC-03 getResults (requires SC-01; nonzero results also require SC-02)', () => {
  it('returns a zero-filled candidate array even for an unpublished draft, and rejects unknown IDs', async () => {
    const f = await election(false);
    expect(await f.voting.getResults(1)).to.deep.equal([0n, 0n, 0n]);
    await expect(f.voting.getResults(999)).to.be.revertedWithCustomError(f.voting, 'ElectionNotFound');
  });
  it('returns counts in candidate order while voting is active', async () => {
    const f = await election(); await f.time(f.startsAt);
    await f.voting.connect(f.alice).vote(1, 2);
    await f.voting.connect(f.bob).vote(1, 1);
    const counts = await f.voting.getResults(1);
    expect(counts).to.deep.equal([0n, 1n, 1n]);
    expect(counts.reduce((sum: bigint, count: bigint) => sum + count, 0n)).to.equal((await f.voting.getElection(1))[0].totalVotes);
    expect(await f.voting.getState(1)).to.equal(2n);
  });
});
