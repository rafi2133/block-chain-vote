<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { PhPlus, PhX, PhArrowRight, PhLockKey, PhSealCheck } from '@phosphor-icons/vue';
import { isAddress } from 'ethers';
import { useBallot } from '../store';
const store = useBallot(), router = useRouter();
const title = ref(''), description = ref('');
const candidates = ref([{ name: '', description: '' }, { name: '', description: '' }]);
const startDelayMinutes = ref(5), durationHours = ref(24), voters = ref('');
watch(() => store.config, config => {
  if (config?.demoEnabled && !voters.value) voters.value = config.demoAccounts.filter(a => a.index >= 1 && a.index <= 3).map(a => `voter-0${a.index},${a.address}`).join('\n');
}, { immediate: true });
async function submit() {
  try {
    const bindings = voters.value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const fields = line.split(',').map(s => s.trim());
      if (fields.length !== 2 || !fields[0] || !isAddress(fields[1]!)) throw new Error('Use one voter ID and valid wallet address per line, separated by a comma.');
      return { personId: fields[0], address: fields[1] };
    });
    if (!bindings.length || bindings.length > 100) throw new Error('Register between 1 and 100 eligible wallets in this demo.');
    const id = await store.createElection({ title: title.value, description: description.value, candidates: candidates.value, voters: bindings, startDelayMinutes: startDelayMinutes.value, durationHours: durationHours.value });
    if (id) await router.push(`/elections/${id}`);
  } catch (error) { store.notify(store.message(error), 'error'); }
}
</script>
<template>
  <div class="page-heading"><div><div class="eyebrow">ADMINISTRATOR</div><h1>Create an election</h1><p>Set the choices. Verify the voters. Publish the rules.</p></div></div>
  <div v-if="!store.isAdmin" class="access-panel"><PhLockKey :size="38" /><h2>Administrator access</h2><p>Connect the administrator account in MetaMask to create an election.<template v-if="store.config?.demoEnabled"> Import the <strong>Administrator</strong> test account from <RouterLink to="/wallet" class="text-button">MetaMask setup</RouterLink>.</template></p><button class="button button-secondary" @click="store.connectMetaMask">Connect administrator MetaMask</button></div>
  <form v-else class="create-grid" @submit.prevent="submit"><fieldset class="form-panel" :disabled="store.busy"><section><h2>Election details</h2><label class="field-label">Election title<input v-model="title" required minlength="3" maxlength="100" placeholder="e.g. Community garden proposal" /></label><label class="field-label">Description<textarea v-model="description" maxlength="1000" rows="3" placeholder="Explain what people are voting on." /></label></section><section><div class="panel-heading"><h2>Candidates</h2><span>Between 2 and 20</span></div><div v-for="candidate, i in candidates" :key="i" class="candidate-fields"><span class="candidate-field-number">{{ String(i+1).padStart(2,'0') }}</span><div><label class="sr-only" :for="`candidate-name-${i}`">Candidate {{ i+1 }} name</label><input :id="`candidate-name-${i}`" v-model="candidate.name" required maxlength="80" :placeholder="`Candidate ${i+1} name`" /><label class="sr-only" :for="`candidate-desc-${i}`">Candidate {{ i+1 }} description</label><input :id="`candidate-desc-${i}`" v-model="candidate.description" maxlength="240" placeholder="A short description (optional)" class="secondary-input" /></div><button v-if="candidates.length > 2" type="button" class="icon-button" :aria-label="`Remove candidate ${i+1}`" @click="candidates.splice(i,1)"><PhX :size="18" /></button></div><button type="button" class="text-button" :disabled="candidates.length >= 20" @click="candidates.push({ name: '', description: '' })"><PhPlus :size="17" />Add candidate</button></section><section><h2>Voting window</h2><div class="field-row"><label class="field-label">Start in (minutes)<input v-model.number="startDelayMinutes" type="number" required min="1" max="10080" /></label><label class="field-label">Duration (hours)<input v-model.number="durationHours" type="number" required min="0.05" max="720" step="0.05" /></label></div><p class="field-help">The window is calculated from chain time. Leave enough time to approve the publication transactions.</p></section><section><h2>Eligible voters</h2><label class="field-label">Verified voter IDs and wallet addresses<textarea v-model="voters" aria-label="Eligible voters" required rows="5" spellcheck="false" class="monospace" placeholder="voter-01,0x…&#10;voter-02,0x…" /></label><p class="field-help">One voter ID and wallet address per line. Reuse the same binding for an existing voter ID. Confirm each identity before publishing.</p></section><div class="form-submit"><span>Three on-chain steps: create, register, publish.</span><button class="button" type="submit">{{ store.busy ? 'Publishing…' : 'Create & publish' }}<PhArrowRight :size="18" /></button></div></fieldset><aside class="publish-summary"><PhSealCheck :size="30" /><h2>Publish with confidence.</h2><p>The smart contract will enforce the rules you set.</p><ul><li>One vote per eligible address</li><li>A fixed candidate order</li><li>A fixed voting window</li><li>A frozen voter list</li></ul><div class="summary-divider"></div><strong>Public by design</strong><p>Wallet addresses and choices are visible on-chain. The backend stores voter bindings separately.</p><strong>After publication</strong><p>Rules and eligibility cannot be changed. If a transaction is cancelled, the saved draft can be resumed.</p></aside></form>
</template>
