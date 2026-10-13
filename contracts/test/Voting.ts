import { expect } from 'chai';
import hre from 'hardhat';

describe('Voting rules', () => {
  async function fixture(publish = true) {
    const { ethers, provider } = await hre.network.create();
    const [admin, alice, bob, carol, outsider] = await ethers.getSigners();
    const token: any = await ethers.deployContract('VoteToken');
    const voting: any = await ethers.deployContract('Voting', [await token.getAddress()]);
    const unit = ethers.parseEther('1');
    for (const voter of [alice, bob, carol]) {
      await token.transfer(voter.address, 10n * unit);
      await token.connect(voter).approve(await voting.getAddress(), 10n * unit);
    }
    const block = await ethers.provider.getBlock('latest');
    const startsAt = block!.timestamp + 100;
    const endsAt = startsAt + 1000;
    const hash = ethers.id('fixed public metadata');
    await voting.createElection(2, hash, startsAt, endsAt);
    await voting.setEligibility(1, [alice.address, bob.address, carol.address], true);
    if (publish) await voting.publishElection(1);
    async function time(t: number) {
      await provider.request({ method: 'evm_setNextBlockTimestamp', params: [t] });
      await provider.request({ method: 'evm_mine', params: [] });
    }
    return { voting, token, unit, ethers, provider, admin, alice, bob, carol, outsider, startsAt, endsAt, hash, time };
  }

  it('accepts exactly three eligible votes and maintains the tally invariant', async () => {
    const f = await fixture();
    await f.time(f.startsAt);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.emit(f.voting, 'VoteCast').withArgs(1, f.alice.address, 0);
    await f.voting.connect(f.bob).vote(1, 1);
    await f.voting.connect(f.carol).vote(1, 0);
    expect(await f.voting.getResults(1)).to.deep.equal([2n, 1n]);
    const [election] = await f.voting.getElection(1);
    expect(election.totalVotes).to.equal(3n);
    expect(election.eligibleVoterCount).to.equal(3n);
  });
  it('rejects repeat votes, keeping the tally unchanged', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    await f.voting.connect(f.alice).vote(1, 0);
    const balance = await f.token.balanceOf(f.alice.address);
    const allowance = await f.token.allowance(f.alice.address, await f.voting.getAddress());
    await expect(f.voting.connect(f.alice).vote(1, 1)).to.be.revertedWithCustomError(f.voting, 'AlreadyVoted');
    expect(await f.voting.getResults(1)).to.deep.equal([1n, 0n]);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(balance);
    expect(await f.token.allowance(f.alice.address, await f.voting.getAddress())).to.equal(allowance);
  });
  it('rejects an unregistered fourth wallet even when it calls the contract directly', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    await expect(f.voting.connect(f.outsider).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'NotEligible');
  });
  it('rejects out-of-range candidates without consuming eligibility', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    await expect(f.voting.connect(f.alice).vote(1, 2)).to.be.revertedWithCustomError(f.voting, 'InvalidCandidate');
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(10n * f.unit);
  });
  it('rejects unpublished elections', async () => {
    const f = await fixture(false); await f.time(f.startsAt);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'NotPublished');
  });
  it('allows a vote exactly at the start boundary', async () => {
    const f = await fixture();
    await f.provider.request({ method: 'evm_setNextBlockTimestamp', params: [f.startsAt] });
    await f.voting.connect(f.alice).vote(1, 0);
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(true);
  });
  it('rejects before the start and exactly at the end boundary', async () => {
    const f = await fixture();
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'VotingNotOpen');
    await f.time(f.endsAt);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.voting, 'VotingNotOpen');
    expect(await f.voting.getState(1)).to.equal(3n);
  });
  it('freezes the list, configuration, and publication after publishing', async () => {
    const f = await fixture();
    await expect(f.voting.setEligibility(1, [f.outsider.address], true)).to.be.revertedWithCustomError(f.voting, 'ElectionFrozen');
    await expect(f.voting.updateDraft(1, 3, f.hash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'ElectionFrozen');
    await expect(f.voting.publishElection(1)).to.be.revertedWithCustomError(f.voting, 'ElectionFrozen');
  });
  it('rejects unauthorized creation and administration', async () => {
    const f = await fixture(false);
    await expect(f.voting.connect(f.outsider).createElection(2, f.hash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'Unauthorized');
    await expect(f.voting.connect(f.alice).setEligibility(1, [f.outsider.address], true)).to.be.revertedWithCustomError(f.voting, 'Unauthorized');
    await expect(f.voting.connect(f.alice).publishElection(1)).to.be.revertedWithCustomError(f.voting, 'Unauthorized');
    await expect(f.voting.connect(f.alice).updateDraft(1, 2, f.hash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'Unauthorized');
  });
  it('handles duplicate additions and removals without corrupting the eligible count', async () => {
    const f = await fixture(false);
    await f.voting.setEligibility(1, [f.alice.address, f.alice.address], true);
    await f.voting.setEligibility(1, [f.bob.address, f.bob.address], false);
    const [election] = await f.voting.getElection(1);
    expect(election.eligibleVoterCount).to.equal(2n);
    expect(await f.voting.eligible(1, f.bob.address)).to.equal(false);
  });
  it('does not publish an empty eligible list or publish after its start', async () => {
    const f = await fixture(false);
    await f.voting.setEligibility(1, [f.alice.address, f.bob.address, f.carol.address], false);
    await expect(f.voting.publishElection(1)).to.be.revertedWithCustomError(f.voting, 'NoEligibleVoters');
    await f.voting.setEligibility(1, [f.alice.address], true);
    await f.time(f.startsAt);
    await expect(f.voting.publishElection(1)).to.be.revertedWithCustomError(f.voting, 'InvalidTimeWindow');
  });
  it('isolates votes and eligibility between elections', async () => {
    const f = await fixture();
    await f.voting.createElection(2, f.hash, f.startsAt, f.endsAt);
    await f.voting.setEligibility(2, [f.alice.address], true); await f.voting.publishElection(2);
    await f.time(f.startsAt);
    await f.voting.connect(f.alice).vote(1, 0); await f.voting.connect(f.alice).vote(2, 1);
    expect(await f.voting.getResults(1)).to.deep.equal([1n, 0n]);
    expect(await f.voting.getResults(2)).to.deep.equal([0n, 1n]);
    expect(await f.voting.eligible(2, f.bob.address)).to.equal(false);
  });
  it('rejects invalid IDs, times, metadata, address batches, and candidate counts', async () => {
    const f = await fixture(false);
    await expect(f.voting.getElection(999)).to.be.revertedWithCustomError(f.voting, 'ElectionNotFound');
    await expect(f.voting.createElection(1, f.hash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.voting.createElection(21, f.hash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.voting.createElection(2, f.ethers.ZeroHash, f.startsAt, f.endsAt)).to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.voting.createElection(2, f.hash, f.endsAt, f.startsAt)).to.be.revertedWithCustomError(f.voting, 'InvalidTimeWindow');
    await expect(f.voting.setEligibility(1, [], true)).to.be.revertedWithCustomError(f.voting, 'InvalidBatch');
    await expect(f.voting.setEligibility(1, Array(101).fill(f.alice.address), true)).to.be.revertedWithCustomError(f.voting, 'InvalidBatch');
    await expect(f.voting.setEligibility(1, [f.ethers.ZeroAddress], true)).to.be.revertedWithCustomError(f.voting, 'InvalidAddress');
  });

  it('atomically burns exactly one token, decreases supply, and consumes an exact approval', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    const supply = await f.token.totalSupply();
    await f.token.connect(f.alice).approve(await f.voting.getAddress(), f.unit);
    await expect(f.voting.connect(f.alice).vote(1, 0))
      .to.emit(f.token, 'Transfer').withArgs(f.alice.address, f.ethers.ZeroAddress, f.unit)
      .and.to.emit(f.voting, 'VoteTokenBurned').withArgs(1, f.alice.address, f.unit);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(9n * f.unit);
    expect(await f.token.totalSupply()).to.equal(supply - f.unit);
    expect(await f.token.balanceOf(await f.voting.getAddress())).to.equal(0n);
    expect(await f.token.allowance(f.alice.address, await f.voting.getAddress())).to.equal(0n);
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(true);
    expect(await f.voting.getResults(1)).to.deep.equal([1n, 0n]);
  });
  it('rejects a missing token approval and rolls back every voting change', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    await f.token.connect(f.alice).approve(await f.voting.getAddress(), 0);
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientAllowance');
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    expect((await f.voting.getElection(1))[0].totalVotes).to.equal(0n);
    expect(await f.voting.getResults(1)).to.deep.equal([0n, 0n]);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(10n * f.unit);
  });
  it('rejects insufficient tokens and preserves the allowance and voting eligibility', async () => {
    const f = await fixture(); await f.time(f.startsAt);
    await f.token.connect(f.alice).transfer(f.bob.address, 10n * f.unit);
    const supply = await f.token.totalSupply();
    await expect(f.voting.connect(f.alice).vote(1, 0)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientBalance');
    expect(await f.token.totalSupply()).to.equal(supply);
    expect(await f.token.allowance(f.alice.address, await f.voting.getAddress())).to.equal(10n * f.unit);
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
    expect((await f.voting.getElection(1))[0].totalVotes).to.equal(0n);
    expect(await f.voting.getResults(1)).to.deep.equal([0n, 0n]);
  });
  it('approval alone does not burn tokens or count a vote', async () => {
    const f = await fixture();
    const supply = await f.token.totalSupply();
    await f.token.connect(f.alice).approve(await f.voting.getAddress(), f.unit);
    expect(await f.token.balanceOf(f.alice.address)).to.equal(10n * f.unit);
    expect(await f.token.totalSupply()).to.equal(supply);
    expect(await f.voting.hasVoted(1, f.alice.address)).to.equal(false);
  });
  it('does not let another wallet use an approval granted to the voting contract', async () => {
    const f = await fixture();
    await expect(f.token.connect(f.outsider).burnFrom(f.alice.address, f.unit)).to.be.revertedWithCustomError(f.token, 'ERC20InsufficientAllowance');
    expect(await f.token.balanceOf(f.alice.address)).to.equal(10n * f.unit);
  });
  it('rejects a token address without deployed code', async () => {
    const f = await fixture();
    await expect(f.ethers.deployContract('Voting', [f.ethers.ZeroAddress])).to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
    await expect(f.ethers.deployContract('Voting', [f.alice.address])).to.be.revertedWithCustomError(f.voting, 'InvalidConfiguration');
  });
});
