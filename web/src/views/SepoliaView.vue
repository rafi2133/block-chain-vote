<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, computed } from 'vue';
import { useRouter } from 'vue-router';
import { BrowserProvider, Contract, ContractFactory, formatEther, formatUnits, keccak256, isError, type Signer } from 'ethers';
import { PhWallet, PhArrowUpRight, PhCheckCircle } from '@phosphor-icons/vue';
import { api, useBallot } from '../store';
import { discoverMetaMask, type MetaMaskProvider } from '../metamask';
import { SEPOLIA_CHAIN_ID, TOKEN_ABI, type SepoliaPlan } from '../../../shared/sepolia';
import { localTestAccounts } from '../local-test-accounts';

const store = useBallot(), router = useRouter();
const plan = ref<SepoliaPlan | null>(null), error = ref(''), status = ref(''), busy = ref(false);
const wallet = ref(''), ethBalance = ref(''), tokenBalance = ref('');
const signer = shallowRef<Signer | null>(null);
const transactionHash = ref(localStorage.getItem('ballot-sepolia-deployment') ?? '');
const cost = computed(() => plan.value ? `${formatUnits(plan.value.voteCost, plan.value.tokenDecimals).replace(/\.0$/, '')} ${plan.value.tokenSymbol}` : '1 TOM');
let injected: MetaMaskProvider | undefined;
const discovery = discoverMetaMask(() => {});
function resetWallet() { signer.value = null; wallet.value = ''; ethBalance.value = ''; tokenBalance.value = ''; }
function fail(e: unknown) { error.value = store.message(e); status.value = ''; }
async function load() {
  error.value = ''; busy.value = true;
  try { plan.value = await api<SepoliaPlan>('/sepolia/plan'); if (plan.value.existingTransactionHash) await store.initialize(); }
  catch(e) { fail(e); }
  finally { busy.value = false; }
}
async function connect() {
  if (!plan.value) return;
  busy.value = true; error.value = '';
  try {
    await store.disconnect();
    injected?.removeListener?.('accountsChanged', resetWallet); injected?.removeListener?.('chainChanged', resetWallet);
    injected = discovery.getProvider();
    if (!injected) throw new Error('Open this page in a browser with MetaMask installed and unlocked.');
    await injected.request({ method: 'eth_requestAccounts' });
    const chainId = '0xaa36a7';
    try { await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch(e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await injected.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: 'Sepolia', rpcUrls: [plan.value.publicRpcUrl],
        nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://sepolia.etherscan.io'] }] });
      await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    }
    if (BigInt(await injected.request({ method: 'eth_chainId' }) as string) !== BigInt(SEPOLIA_CHAIN_ID)) throw new Error('Switch MetaMask to Sepolia.');
    const provider = new BrowserProvider(injected, undefined, { cacheTimeout: -1 });
    const current = await provider.getSigner();
    const address = await current.getAddress();
    if (localTestAccounts.some(account => account.address.toLowerCase() === address.toLowerCase())) throw new Error('Connect your own Sepolia wallet. Public Hardhat test accounts cannot deploy this application.');
    if (keccak256(await provider.getCode(plan.value.tokenAddress)) !== plan.value.tokenRuntimeCodeHash) throw new Error('Tom Token bytecode does not match the verified Sepolia contract.');
    const token = new Contract(plan.value.tokenAddress, TOKEN_ABI, current);
    await token.burnFrom.staticCall(address, 0);
    const [eth, tom] = await Promise.all([provider.getBalance(address), token.balanceOf(address)]);
    ethBalance.value = formatEther(eth); tokenBalance.value = formatUnits(tom, plan.value.tokenDecimals);
    signer.value = current; wallet.value = address;
    for (const event of ['accountsChanged', 'chainChanged']) injected.on?.(event, resetWallet);
    status.value = 'Sepolia wallet connected. This address will administer the elections.';
  } catch(e) { resetWallet(); fail(e); }
  finally { busy.value = false; }
}
async function finish() {
  busy.value = true; error.value = ''; status.value = 'Verifying the Sepolia receipt and voting rules…';
  try {
    await api('/sepolia/complete', { transactionHash: transactionHash.value.trim() });
    localStorage.removeItem('ballot-sepolia-deployment');
    await store.initialize();
    if (!store.config || store.config.chainId !== SEPOLIA_CHAIN_ID) throw new Error(store.loadError || 'Workspace activation is still pending. Retry finishing setup.');
    store.notify('Sepolia is ready. Each successful vote burns 1 TOM.', 'success');
    await router.push('/');
  } catch(e) { fail(e); }
  finally { busy.value = false; }
}
async function deploy() {
  if (!plan.value || !signer.value || !injected || transactionHash.value) return;
  busy.value = true; error.value = '';
  try {
    const accounts = await injected.request({ method: 'eth_accounts' }) as string[];
    if (accounts[0]?.toLowerCase() !== wallet.value.toLowerCase() || BigInt(await injected.request({ method: 'eth_chainId' }) as string) !== BigInt(SEPOLIA_CHAIN_ID)) throw new Error('The wallet account or network changed. Connect again.');
    const provider = signer.value.provider!;
    if (keccak256(await provider.getCode(plan.value.tokenAddress)) !== plan.value.tokenRuntimeCodeHash) throw new Error('Tom Token bytecode changed. Reload setup before deploying.');
    const factory = new ContractFactory(plan.value.abi, plan.value.bytecode, signer.value);
    status.value = 'Confirm contract deployment in MetaMask. Gas is paid in Sepolia ETH.';
    const voting = await factory.deploy(plan.value.tokenAddress);
    const tx = voting.deploymentTransaction()!;
    transactionHash.value = tx.hash; localStorage.setItem('ballot-sepolia-deployment', tx.hash);
    status.value = 'Deployment submitted. Waiting for two Sepolia confirmations…';
    try { await tx.wait(2); }
    catch(e) {
      if (!isError(e, 'TRANSACTION_REPLACED') || e.cancelled) throw e;
      transactionHash.value = e.receipt.hash; localStorage.setItem('ballot-sepolia-deployment', e.receipt.hash);
    }
    await finish();
  } catch(e) { fail(e); }
  finally { busy.value = false; }
}
onMounted(load);
onBeforeUnmount(() => { discovery.destroy(); injected?.removeListener?.('accountsChanged', resetWallet); injected?.removeListener?.('chainChanged', resetWallet); });
</script>

<template>
  <div class="sepolia-setup">
  <div class="page-heading"><div><div class="eyebrow"><span class="tiny-line"></span>Your public testnet workspace</div><h1>Deploy to Sepolia</h1><p>Use your Tom Token for voting. Deploy and confirm with MetaMask.</p></div><div class="page-symbol"><PhWallet :size="32" /></div></div>
  <section class="form-panel wallet-setup-card">
    <h2>1. Review the voting rules</h2>
    <dl class="setup-network"><div><dt>Network</dt><dd>Ethereum Sepolia · 11155111</dd></div><div><dt>Token</dt><dd>{{ plan?.tokenName ?? 'Tom Token' }} (TOM)</dd></div><div><dt>Cost per vote</dt><dd>{{ cost }} burned on success</dd></div><div><dt>Token contract</dt><dd><a :href="`https://sepolia.etherscan.io/address/${plan?.tokenAddress ?? '0xE2311e42e7685f097efCf96aF6CeEF11d5Adbe54'}`" target="_blank" rel="noopener noreferrer"><code>{{ plan?.tokenAddress ?? '0xE2311e42e7685f097efCf96aF6CeEF11d5Adbe54' }}</code><PhArrowUpRight :size="15" /></a></dd></div></dl>
    <p v-if="plan"><PhCheckCircle :size="17" /> Token metadata and burnFrom simulation verified on Sepolia.</p>
    <p>Deploying creates the voting contract. Your existing TOM supply and balances remain in the Tom Token contract. Voters approve exactly {{ cost }} when required, then confirm their vote in MetaMask.</p>
    <p v-if="plan?.existingTransactionHash">The Sepolia voting contract is already configured. <RouterLink to="/" class="text-button" @click="store.initialize">Open elections<PhArrowUpRight :size="15" /></RouterLink></p>
  </section>
  <section v-if="!plan?.existingTransactionHash" class="form-panel wallet-setup-card">
    <h2>2. Connect the administrator wallet</h2><p>Connect your own wallet with Sepolia ETH for deployment Gas. Use this same wallet to create elections and register eligible voters.</p>
    <button class="button" :disabled="busy || !plan" @click="connect"><PhWallet :size="18" />{{ wallet ? 'Reconnect MetaMask' : 'Connect MetaMask on Sepolia' }}</button>
    <dl v-if="wallet" class="setup-network"><div><dt>Administrator</dt><dd><code>{{ wallet }}</code></dd></div><div><dt>Gas balance</dt><dd>{{ ethBalance }} Sepolia ETH</dd></div><div><dt>Token balance</dt><dd>{{ tokenBalance }} TOM</dd></div></dl>
    <h2>3. Deploy the voting contract</h2><p>The deployment transaction binds this contract to Tom Token and fixes the cost at {{ cost }} per successful vote.</p>
    <button class="button" :disabled="busy || !signer || !!transactionHash" @click="deploy">Deploy with MetaMask<PhArrowUpRight :size="18" /></button>
    <p>After confirmation, the app verifies the transaction and opens your Sepolia elections workspace.</p>
    <details><summary>Resume a submitted deployment</summary><label class="field-label">Deployment transaction hash<input v-model="transactionHash" placeholder="0x…" :disabled="busy" /></label><button class="button button-secondary" :disabled="busy || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash.trim())" @click="finish">Verify and finish setup</button></details>
  </section>
  <p v-if="status" role="status">{{ status }}</p>
  <div v-if="error" class="error-banner" role="alert"><p>{{ error }}</p><button v-if="!plan" class="button button-secondary" :disabled="busy" @click="load">Retry Token verification</button></div>
  <a v-if="transactionHash" :href="`https://sepolia.etherscan.io/tx/${transactionHash.trim()}`" target="_blank" rel="noopener noreferrer" class="text-button">View deployment on Etherscan<PhArrowUpRight :size="16" /></a>
  </div>
</template>
