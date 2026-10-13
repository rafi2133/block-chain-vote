<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { PhArrowLeft, PhCheckCircle, PhSealCheck, PhClock, PhUsers, PhArrowRight, PhCopy, PhDownloadSimple, PhWarningCircle, PhArrowUpRight } from '@phosphor-icons/vue';
import { keccak256, toUtf8Bytes } from 'ethers';
import { useBallot, shortAddress, dateTime } from '../store';
const store = useBallot(), route = useRoute();
const selected = ref<number | null>(null);
const election = computed(() => store.elections.find(e => e.id === Number(route.params.id)));
const status = computed(() => store.walletStatuses[Number(route.params.id)]);
const verified = computed(() => !!election.value?.rawMetadata && keccak256(toUtf8Bytes(election.value.rawMetadata)) === election.value.metadataHash && election.value.metadata?.candidates.length === election.value.candidateCount);
const canVote = computed(() => election.value?.state === 'Active' && verified.value && status.value?.eligible && !status.value.voted && !!store.address && store.hasEnoughTokens && !store.busy && !store.walletLoading);
const hint = computed(() => {
  if (!verified.value) return 'Election metadata could not be verified. Voting is disabled.';
  if (election.value?.state === 'Draft') return 'This election has not been published yet.';
  if (election.value?.state === 'Ended') return 'Voting has ended. The final tally is available below.';
  if (election.value?.state === 'Scheduled') return 'Voting opens at the scheduled start time.';
  if (!store.address) return 'Connect MetaMask to vote. Approval and voting are confirmed in the wallet extension.';
  if (!status.value) return 'Checking your wallet’s eligibility…';
  if (status.value.voted) return 'Your vote is recorded on-chain. Each eligible wallet can vote once.';
  if (!status.value.eligible) return 'This wallet is not on the eligible voter list.';
  if (store.tokenBalance === null) return `Checking your ${store.config?.tokenSymbol ?? 'Token'} balance…`;
  if (!store.hasEnoughTokens) return `Insufficient ${store.config?.tokenSymbol ?? 'Token'} balance. You need ${store.voteCostLabel} to cast a vote.`;
  return 'Choose one candidate. MetaMask will ask you to confirm the transaction.';
});
const participation = computed(() => election.value?.eligibleVoterCount ? Math.round(election.value.totalVotes / election.value.eligibleVoterCount * 100) : 0);
const maxVotes = computed(() => Math.max(0, ...(election.value?.counts ?? [])));
watch(() => route.params.id, () => selected.value = null);
async function submit() {
  if (election.value && selected.value !== null && canVote.value) await store.vote(election.value, selected.value);
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); store.notify('Copied to clipboard.', 'success'); }
  catch { store.notify('Copy is unavailable in this browser. Select the displayed value instead.', 'info'); }
}
function download() {
  if (!election.value?.rawMetadata) return;
  const url = URL.createObjectURL(new Blob([election.value.rawMetadata], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `election-${election.value.id}-metadata.json`; link.click(); URL.revokeObjectURL(url);
}
</script>
<template>
  <div v-if="!election" class="empty-state"><h1>Election not found</h1><p>This election is not available in the current deployment.</p><RouterLink to="/" class="button button-secondary">Back to elections</RouterLink></div>
  <template v-else>
    <RouterLink to="/" class="back-link"><PhArrowLeft :size="17" />All elections</RouterLink>
    <div class="detail-heading"><div class="detail-meta"><span class="badge" :class="election.state.toLowerCase()">{{ { Active: 'Voting open', Ended: 'Completed', Scheduled: 'Scheduled', Draft: 'Draft' }[election.state] }}</span><span class="election-id">ELECTION {{ String(election.id).padStart(3,'0') }}</span></div><h1>{{ election.metadata?.title ?? `Election #${election.id}` }}</h1><p>{{ election.metadata?.description ?? 'Metadata is unavailable. Inspect the contract record before continuing.' }}</p></div>
    <div class="detail-grid">
      <section class="ballot-panel"><div class="panel-heading"><h2>{{ election.state === 'Ended' ? 'Final results' : 'Your ballot' }}</h2><span>{{ election.candidateCount }} candidates · Single choice</span></div>
        <div class="vote-message" :class="{ 'vote-recorded': status?.voted, 'vote-warning': !verified || (!!store.address && status && !status.eligible) }"><PhCheckCircle v-if="status?.voted" :size="21" /><PhWarningCircle v-else-if="!verified" :size="21" /><PhSealCheck v-else :size="21" /><p>{{ hint }}</p></div>
        <div v-if="election.state !== 'Ended'" class="token-cost-panel"><div><span>COST PER VOTE</span><strong>{{ store.voteCostLabel }}</strong><p>Burned only when the vote succeeds · ETH Gas is separate</p></div><div v-if="store.address"><span>YOUR TOKEN BALANCE</span><strong data-testid="token-balance">{{ store.tokenBalanceLabel }}</strong></div></div>
        <fieldset class="candidate-list" :disabled="!canVote" aria-label="Candidates">
          <label v-for="count, index in election.counts" :key="index" class="candidate" :class="{ selected: selected === index, 'results-candidate': election.state === 'Ended' }">
            <input v-if="election.state !== 'Ended'" v-model="selected" type="radio" name="candidate" :value="index" :aria-label="election.metadata?.candidates[index]?.name ?? `Candidate ${index+1}`" /><span v-else class="result-number">{{ String(index+1).padStart(2,'0') }}</span>
            <div class="candidate-content"><div class="candidate-title"><h3>{{ election.metadata?.candidates[index]?.name ?? `Candidate ${index+1}` }}</h3><span v-if="election.state === 'Ended' && count === maxVotes && maxVotes > 0" class="winner-label">{{ election.counts.filter(v => v === maxVotes).length > 1 ? 'Tie' : 'Selected' }}</span></div><p>{{ election.metadata?.candidates[index]?.description }}</p><div v-if="election.state === 'Ended'" class="result-bar"><span :style="{ width: `${election.totalVotes ? count / election.totalVotes * 100 : 0}%` }"></span></div></div><div v-if="election.state === 'Ended'" class="candidate-tally"><strong>{{ count }}</strong><span>votes</span></div>
          </label>
        </fieldset>
        <div class="ballot-submit" v-if="election.state !== 'Ended'"><p><PhClock :size="16" />A vote is counted after successful on-chain execution.</p><button class="button" :disabled="!canVote || selected === null" @click="submit">{{ status?.voted ? 'Vote recorded' : store.busy ? 'Confirming…' : 'Cast vote' }}<PhArrowRight :size="18" /></button></div>
        <button v-if="store.isAdmin && election.state === 'Draft'" class="button resume-button" :disabled="store.busy" @click="store.resumeElection(election.id)">Resume publication<PhArrowRight :size="18" /></button>
        <p class="zero-votes" v-if="election.state === 'Ended' && !election.totalVotes">No votes were cast in this election.</p>
      </section>
      <aside class="election-summary"><h2>Election at a glance</h2><div class="participation"><strong>{{ participation }}<span>%</span></strong><span>participation</span></div><div class="participation-track"><span :style="{ width: `${participation}%` }"></span></div><p class="participation-note">{{ election.totalVotes }} of {{ election.eligibleVoterCount }} eligible wallets have voted</p><div class="summary-divider"></div><dl><div><dt><PhUsers :size="18" />Eligible voters</dt><dd>{{ election.eligibleVoterCount }}</dd></div><div><dt><PhClock :size="18" />Voting opens</dt><dd>{{ dateTime(election.startsAt) }}</dd></div><div><dt><PhClock :size="18" />Voting closes</dt><dd>{{ dateTime(election.endsAt) }}</dd></div></dl><div class="summary-divider"></div><div class="verification-state"><PhSealCheck :size="22" /><div><strong>{{ verified ? 'Metadata verified' : 'Metadata unavailable' }}</strong><p>{{ verified ? 'The displayed candidate order matches the committed on-chain hash.' : 'The displayed information could not be verified.' }}</p></div></div><p class="visibility-note">This is a public vote. Wallet addresses and choices can be inspected on-chain.</p></aside>
    </div>
    <details class="audit-panel"><summary><span><PhSealCheck :size="20" />Verify this election</span><span class="muted">View contract, metadata hash, and block</span></summary><div class="audit-content"><div><span>CONTRACT ADDRESS</span><code>{{ store.config?.contractAddress }}</code><button class="text-button" @click="copy(store.config!.contractAddress)"><PhCopy :size="15" />Copy address</button><span>{{ store.config?.tokenSymbol }} TOKEN · ERC-20</span><code>{{ store.config?.tokenAddress }}</code></div><div><span>METADATA HASH · KECCAK-256</span><code>{{ election.metadataHash }}</code><button v-if="election.rawMetadata" class="text-button" @click="download"><PhDownloadSimple :size="15" />Download exact metadata bytes</button></div><div><span>ON-CHAIN SNAPSHOT</span><p>Chain {{ store.config?.chainId }} · Block {{ election.blockNumber }}<br>Contract state: {{ election.state }}</p></div></div></details>
    <div v-if="store.transaction?.hash && store.transaction.electionId === election.id" class="receipt-panel"><PhCheckCircle :size="21" /><div><strong>{{ store.transaction.phase === 'Confirmed' ? 'Transaction confirmed' : 'Transaction submitted' }}</strong><p>{{ store.transaction.label }}</p><code>{{ store.transaction.hash }}</code></div><a v-if="store.config?.chainId === 11155111" :href="`https://sepolia.etherscan.io/tx/${store.transaction.hash}`" target="_blank" rel="noopener noreferrer" class="text-button">Explorer<PhArrowUpRight :size="16" /></a><button v-else class="icon-button" aria-label="Copy transaction hash" @click="copy(store.transaction.hash)"><PhCopy :size="18" /></button></div>
  </template>
</template>
