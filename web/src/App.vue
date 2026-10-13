<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { PhCheckSquare, PhSquaresFour, PhBroadcast, PhPlus, PhWallet, PhSignOut, PhList, PhX, PhArrowUpRight, PhCheckCircle, PhWarningCircle, PhCircleNotch } from '@phosphor-icons/vue';
import { api, useBallot, shortAddress } from './store';
const store = useBallot(), route = useRoute(), router = useRouter();
const mobileOpen = ref(false);
let timer: ReturnType<typeof setInterval>;
onMounted(async () => {
  if (route.path === '/sepolia') store.loading = false;
  else {
    await store.initialize();
    if (!store.config) {
      try { const setup = await api<{ ready: boolean }>('/sepolia/status'); if (!setup.ready) { store.loadError = ''; await router.replace('/sepolia'); } } catch {}
    }
  }
  timer = setInterval(() => { if (store.config) void store.refresh(); }, 15000);
});
onBeforeUnmount(() => {
  clearInterval(timer); store.destroy();
});
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">Skip to content</a>
    <aside id="workspace-navigation" class="sidebar" :class="{ 'mobile-open': mobileOpen }">
      <RouterLink to="/" class="brand" @click="mobileOpen = false"><span class="brand-mark"><PhCheckSquare :size="25" weight="bold" /></span>ballot<span class="brand-period">.</span></RouterLink>
      <p class="brand-caption">Decisions, recorded.</p>
      <p class="sidebar-label">Your workspace</p>
      <nav aria-label="Main navigation">
        <RouterLink to="/" class="nav-link" :class="{ 'nav-active': route.path === '/' || route.path.startsWith('/elections/') }" @click="mobileOpen = false"><PhSquaresFour :size="20" />Elections<span class="nav-count" v-if="store.elections.length">{{ store.elections.length }}</span></RouterLink>
        <RouterLink to="/activity" class="nav-link" active-class="nav-active" @click="mobileOpen = false"><PhBroadcast :size="20" />On-chain activity</RouterLink>
        <RouterLink to="/create" class="nav-link" active-class="nav-active" @click="mobileOpen = false"><PhPlus :size="20" />Create election</RouterLink>
        <RouterLink to="/wallet" class="nav-link" active-class="nav-active" @click="mobileOpen = false"><PhWallet :size="20" />MetaMask setup</RouterLink>
        <RouterLink v-if="route.path === '/sepolia'" to="/sepolia" class="nav-link" active-class="nav-active" @click="mobileOpen = false"><PhArrowUpRight :size="20" />Sepolia deployment</RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <div class="wallet-help"><span class="wallet-help-icon"><PhWallet :size="21" /></span><strong>Your wallet. Your vote.</strong><p>Approve and confirm each vote in MetaMask.</p><RouterLink to="/wallet" class="text-button" @click="mobileOpen = false">Set up MetaMask<PhArrowUpRight :size="15" /></RouterLink></div>
        <div class="network-status"><span class="status-dot" :class="{ 'is-offline': !!store.loadError }"></span><div><strong>{{ store.config?.chainId === 31337 ? 'Hardhat local network' : 'Ethereum Sepolia' }}</strong><span>{{ store.config ? `Chain ${store.config.chainId} · Block ${store.blockNumber.toLocaleString()}` : route.path === '/sepolia' ? 'Deployment setup · Chain 11155111' : 'Connecting to the network…' }}</span></div></div>
        <p class="sidebar-caption">Public voting. Independently verifiable.</p>
      </div>
    </aside>
    <button v-if="mobileOpen" class="mobile-backdrop" aria-label="Close navigation" @click="mobileOpen = false"></button>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumb"><button class="icon-button mobile-menu" aria-label="Toggle navigation" :aria-expanded="mobileOpen" aria-controls="workspace-navigation" @click="mobileOpen = !mobileOpen"><PhX v-if="mobileOpen" :size="22" /><PhList v-else :size="22" /></button><span>Workspace</span><span class="breadcrumb-divider">/</span><strong>{{ route.meta.title }}</strong></div>
        <div class="wallet-area"><span class="network-chip" v-if="store.config?.demoEnabled">Local demo</span><button v-if="!store.address" class="button button-compact" :disabled="!store.config || store.walletLoading" @click="store.connectMetaMask"><PhWallet :size="18" />{{ store.walletLoading ? 'Connecting…' : 'Connect MetaMask' }}</button><template v-else><span class="connected-wallet"><PhWallet :size="18" />{{ shortAddress(store.address) }}</span><button class="icon-button" aria-label="Disconnect wallet" :disabled="store.busy" @click="store.disconnect"><PhSignOut :size="19" /></button></template></div>
      </header>
      <main id="main-content" tabindex="-1">
        <div v-if="store.loadError" class="error-banner" role="alert"><PhWarningCircle :size="22" /><div><strong>Unable to read the workspace</strong><p>{{ store.loadError }}</p></div><button class="button button-secondary button-compact" @click="store.initialize">Retry</button></div>
        <div v-if="store.loading" class="loading-state" role="status"><p>Reading the on-chain record…</p><div class="loading-skeleton" aria-hidden="true"><div class="skeleton skeleton-heading"></div><div class="skeleton skeleton-overview"></div><div class="skeleton-cards"><div class="skeleton"></div><div class="skeleton"></div></div></div></div>
        <RouterView v-else />
      </main>
      <footer class="page-footer"><span><PhCheckCircle :size="16" />On-chain rules. Public results.</span><span>Ethereum · Hardhat · Express · Vue<PhArrowUpRight :size="15" /></span></footer>
    </div>
    <div v-if="store.busy && store.transaction" class="transaction-toast" role="status"><PhCircleNotch :size="22" class="spinning" /><div><strong>{{ store.transaction.label }}</strong><span>{{ store.transaction.phase }}</span></div></div>
    <div v-if="store.notice" class="notice" :class="store.notice.kind" role="status"><PhWarningCircle v-if="store.notice.kind === 'error'" :size="22" /><PhCheckCircle v-else :size="22" /><span>{{ store.notice.text }}</span><button class="icon-button" aria-label="Dismiss notification" @click="store.notice = null"><PhX :size="18" /></button></div>
  </div>
</template>
