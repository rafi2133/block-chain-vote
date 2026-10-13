<script setup lang="ts">
import { computed, ref } from 'vue';
import { PhArrowUpRight, PhPlus, PhMagnifyingGlass, PhClock, PhUsers, PhSealCheck, PhArrowRight, PhCheckCircle, PhCheckSquare } from '@phosphor-icons/vue';
import { useBallot, dateTime } from '../store';
const store = useBallot();
const filter = ref('All'), search = ref('');
const tabs = ['All', 'Live', 'Scheduled', 'Completed'];
const open = computed(() => store.elections.filter(e => e.state === 'Active').length);
const voteCount = computed(() => store.elections.reduce((n,e) => n+e.totalVotes, 0));
const filtered = computed(() => store.elections.filter(e => {
  const status = filter.value === 'All' || ({ Live: 'Active', Scheduled: 'Scheduled', Completed: 'Ended' } as Record<string,string>)[filter.value] === e.state;
  return status && (e.metadata?.title ?? `Election ${e.id}`).toLowerCase().includes(search.value.toLowerCase());
}));
</script>
<template>
  <div class="page-heading"><div><div class="eyebrow"><span class="tiny-line"></span>The voting workspace</div><h1>Elections</h1><p>Make a choice. Leave a record everyone can verify.</p></div><div class="heading-action"><span>Bring a shared decision on-chain.</span><RouterLink to="/create" class="button"><PhPlus :size="18" />Create election</RouterLink></div></div>
  <section class="overview" aria-label="Workspace statistics"><div><span class="metric-label">Elections in this workspace</span><strong>{{ store.elections.length.toString().padStart(2,'0') }}</strong><span class="metric-note">Across the public record</span></div><div><span class="metric-label">Open for voting</span><strong>{{ open.toString().padStart(2,'0') }}<span class="live-indicator" v-if="open">LIVE</span></strong><span class="metric-note">Your next decision awaits</span></div><div><span class="metric-label">Votes recorded</span><strong>{{ voteCount.toString().padStart(2,'0') }}</strong><span class="metric-note"><PhSealCheck :size="15" />Counted by the smart contract</span></div></section>
  <div class="section-toolbar"><div class="tabs" role="tablist" aria-label="Election status"><button v-for="tab in tabs" :key="tab" role="tab" :aria-selected="filter === tab" :class="{ active: filter === tab }" @click="filter = tab">{{ tab }}<span v-if="tab === 'Live' && open">{{ open }}</span></button></div><label class="search"><PhMagnifyingGlass :size="18" /><input v-model="search" type="search" aria-label="Search elections" placeholder="Search elections…" /></label></div>
  <div class="election-list">
    <RouterLink v-for="e in filtered" :key="e.id" :to="`/elections/${e.id}`" class="election-card" :class="{ 'election-live': e.state === 'Active' }">
      <div class="election-card-top"><span class="badge" :class="e.state.toLowerCase()"><span v-if="e.state === 'Active'" class="status-dot"></span>{{ { Active: 'Voting open', Ended: 'Completed', Scheduled: 'Scheduled', Draft: 'Draft' }[e.state] }}</span><span class="election-id">No. {{ String(e.id).padStart(3,'0') }}</span></div>
      <div class="election-card-body"><div><h2>{{ e.metadata?.title ?? `Election #${e.id}` }}</h2><p>{{ e.metadata?.description ?? 'Metadata is unavailable. Open the election to inspect its on-chain record.' }}</p></div><span class="card-arrow"><PhArrowUpRight :size="25" /></span></div>
      <div class="card-vote-context"><span><PhCheckSquare :size="18" />{{ e.candidateCount }} choices · One vote per wallet</span><span v-if="e.state === 'Active'" class="card-token-cost">{{ store.voteCostLabel }} per vote</span><span class="verified-label" v-else-if="e.verified"><PhSealCheck :size="17" />Verified record</span></div>
      <div class="election-card-bottom"><div class="card-facts"><span><PhUsers :size="17" />{{ e.totalVotes }} of {{ e.eligibleVoterCount }} votes</span><span><PhClock :size="17" />{{ e.state === 'Ended' ? 'Closed' : e.state === 'Scheduled' ? 'Opens' : 'Closes' }} {{ dateTime(e.state === 'Scheduled' ? e.startsAt : e.endsAt) }}</span></div><span class="card-action">{{ e.state === 'Ended' ? 'View results' : e.state === 'Draft' ? 'View draft' : 'View election' }}<PhArrowRight :size="17" /></span></div>
    </RouterLink>
    <div v-if="!filtered.length" class="empty-state"><PhCheckCircle :size="36" /><h2>No elections here yet</h2><p>{{ search ? 'Try a different search.' : 'Choose another status or create a new election.' }}</p></div>
  </div>
  <div class="public-note"><PhSealCheck :size="22" /><div><strong>A record you can check.</strong><p>Votes are public and counted on-chain. Identity verification determines who is eligible; the contract enforces one vote per eligible address.</p></div></div>
</template>
