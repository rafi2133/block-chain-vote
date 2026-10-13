<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { PhBroadcast, PhCopy, PhArrowUpRight } from '@phosphor-icons/vue';
import { api, useBallot, shortAddress } from '../store';
const store = useBallot();
type Event = { name: string; txHash: string; logIndex: number; blockNumber: number; args: Record<string,string> };
const events = ref<Event[]>([]), warning = ref(''), error = ref('');
let timer: ReturnType<typeof setInterval>;
async function refresh() {
  try { const data = await api<{ events: Event[]; warning: string | null }>('/activity'); events.value = data.events; warning.value = data.warning ?? ''; error.value = ''; }
  catch (e) { error.value = store.message(e); }
}
const labels: Record<string,string> = { VoteCast: 'Vote recorded', VoteTokenBurned: 'Token burned', ElectionPublished: 'Election published', EligibilityUpdated: 'Eligibility updated', ElectionCreated: 'Election created', DraftUpdated: 'Draft updated' };
onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 5000); });
onBeforeUnmount(() => clearInterval(timer));
async function copy(hash: string) { try { await navigator.clipboard.writeText(hash); store.notify('Transaction hash copied.', 'success'); } catch { store.notify(hash, 'info'); } }
</script>
<template>
  <div class="page-heading"><div><div class="eyebrow">THE PUBLIC RECORD</div><h1>On-chain activity</h1><p>A trace of what happened, directly from contract events.</p></div><PhBroadcast :size="32" class="accent-icon" /></div>
  <p v-if="warning || error" class="error-banner" role="alert">{{ warning || error }}</p>
  <div class="activity-table-wrapper"><table class="activity-table"><thead><tr><th>Event</th><th>Election</th><th>Block</th><th>Transaction</th></tr></thead><tbody><tr v-for="event in events" :key="`${event.txHash}-${event.logIndex}`"><td><strong>{{ event.name === 'VoteTokenBurned' ? `${store.voteCostLabel} burned` : labels[event.name] ?? event.name }}</strong><span v-if="event.args.voter">{{ shortAddress(event.args.voter) }}</span></td><td><RouterLink :to="`/elections/${event.args.electionId}`">#{{ event.args.electionId }}</RouterLink></td><td>{{ event.blockNumber }}</td><td><a v-if="store.config?.chainId === 11155111" :href="`https://sepolia.etherscan.io/tx/${event.txHash}`" target="_blank" rel="noopener noreferrer">{{ shortAddress(event.txHash) }}<PhArrowUpRight :size="15" /></a><button v-else class="text-button" @click="copy(event.txHash)"><code>{{ shortAddress(event.txHash) }}</code><PhCopy :size="15" /></button></td></tr><tr v-if="!events.length"><td colspan="4" class="table-empty">No indexed events yet. The indexer refreshes every few seconds.</td></tr></tbody></table></div>
  <div class="public-note"><PhBroadcast :size="22" /><div><strong>Replayable, not replaceable.</strong><p>This list is a database cache of contract events. It can be rebuilt from the deployment block. Vote totals are always read from the contract.</p></div></div>
</template>
