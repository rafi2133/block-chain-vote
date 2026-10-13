import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { BrowserProvider, Contract, JsonRpcProvider, keccak256, toUtf8Bytes, isError, formatUnits, type Signer, type TransactionResponse, type TransactionReceipt } from 'ethers';
import type { AppConfig, ElectionView, PreparedDraft } from '../../shared/types';
import { discoverMetaMask, type MetaMaskProvider } from './metamask';

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}
export const shortAddress = (value: string) => `${value.slice(0,6)}…${value.slice(-4)}`;
export const dateTime = (value: number) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value * 1000));
const errors: Record<string, string> = {
  AlreadyVoted: 'This wallet has already voted in this election.', NotEligible: 'This wallet is not on the eligible voter list.',
  VotingNotOpen: 'Voting is not open. The transaction execution time must be inside the voting window.',
  ElectionFrozen: 'Published elections cannot be changed.', Unauthorized: 'Only the administrator can perform this action.',
  InvalidCandidate: 'Please choose a valid candidate.', InvalidTimeWindow: 'The start time has passed. Resume publication to schedule a new window.',
  NotPublished: 'This election has not been published yet.',
  ERC20InsufficientBalance: 'Insufficient voting Token balance.',
  ERC20InsufficientAllowance: 'Approve the required voting Token amount before submitting your vote.',
};
export const useBallot = defineStore('ballot', () => {
  const config = ref<AppConfig | null>(null);
  const elections = ref<ElectionView[]>([]);
  const loading = ref(true), loadError = ref('');
  const address = ref(''), walletLoading = ref(false), metaMaskAvailable = ref(false);
  const signer = shallowRef<Signer | null>(null);
  const readProvider = shallowRef<JsonRpcProvider | null>(null);
  const walletStatuses = ref<Record<number, { eligible: boolean; voted: boolean }>>({});
  const notice = ref<{ text: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const transaction = ref<{ label: string; phase: string; hash: string; electionId?: number } | null>(null);
  const busy = ref(false), blockNumber = ref(0);
  const tokenBalance = ref<string | null>(null);
  const tokenAllowance = ref<string | null>(null);
  const voteCostLabel = computed(() => config.value ? `${formatUnits(config.value.voteCost, config.value.tokenDecimals).replace(/\.0$/, '')} ${config.value.tokenSymbol}` : '1 VOTE');
  const tokenBalanceLabel = computed(() => tokenBalance.value !== null && config.value ? `${formatUnits(tokenBalance.value, config.value.tokenDecimals).replace(/\.0$/, '')} ${config.value.tokenSymbol}` : 'Checking…');
  const hasEnoughTokens = computed(() => tokenBalance.value !== null && !!config.value && BigInt(tokenBalance.value) >= BigInt(config.value.voteCost));
  const isAdmin = computed(() => !!address.value && address.value.toLowerCase() === config.value?.admin.toLowerCase());
  let refreshing = false;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const discovery = discoverMetaMask(available => metaMaskAvailable.value = available);
  let connectedProvider: MetaMaskProvider | undefined;
  const onWalletChanged = () => void walletChanged();
  function detachProvider() {
    connectedProvider?.removeListener?.('accountsChanged', onWalletChanged);
    connectedProvider?.removeListener?.('chainChanged', onWalletChanged);
    connectedProvider?.removeListener?.('disconnect', onWalletChanged);
    connectedProvider = undefined;
  }
  function notify(text: string, kind: 'success' | 'error' | 'info' = 'info') {
    notice.value = { text, kind }; clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.value = null, kind === 'error' ? 12000 : 6000);
  }
  function message(error: unknown) {
    if (isError(error, 'ACTION_REJECTED') || (error as { code?: number })?.code === 4001) return 'MetaMask request rejected. Any previously confirmed transaction remains on-chain. A confirmed Token approval remains available.';
    if ((error as { code?: number })?.code === -32002) return 'A MetaMask request is already open. Open the extension and complete or reject it.';
    if (isError(error, 'INSUFFICIENT_FUNDS')) return 'This wallet needs test ETH to pay the transaction fee.';
    const e = error as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
    const data = e.data ?? e.info?.error?.data;
    if (data && config.value) {
      for (const abi of [config.value.abi, config.value.tokenAbi]) {
        try { const decoded = new Contract(config.value.contractAddress, abi).interface.parseError(data); if (decoded?.name === 'ERC20InsufficientBalance') return `Insufficient ${config.value.tokenSymbol} balance. Each vote requires ${voteCostLabel.value}.`; if (decoded?.name === 'ERC20InsufficientAllowance') return `Approve ${voteCostLabel.value} for the voting contract before submitting your vote.`; if (decoded && errors[decoded.name]) return errors[decoded.name]!; } catch {}
      }
    }
    return e.shortMessage ?? e.message ?? 'Something went wrong. Please try again.';
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const data = await api<{ elections: ElectionView[]; blockNumber: number }>('/elections');
      elections.value = data.elections; blockNumber.value = data.blockNumber; loadError.value = '';
      if (address.value && readProvider.value && config.value) {
        const wallet = address.value;
        const token = new Contract(config.value.tokenAddress, config.value.tokenAbi, readProvider.value);
        const contract = new Contract(config.value.contractAddress, config.value.abi, readProvider.value);
        const [balance, allowance, statuses] = await Promise.all([
          token.balanceOf(wallet), token.allowance(wallet, config.value.contractAddress),
          Promise.all(data.elections.map(async e => {
          const [eligible, voted] = await contract.getVoterStatus(e.id, wallet);
          return [e.id, { eligible: !!eligible, voted: !!voted }] as const;
        }))]);
        if (wallet === address.value) {
          walletStatuses.value = Object.fromEntries(statuses);
          tokenBalance.value = balance.toString(); tokenAllowance.value = allowance.toString();
        }
      } else { walletStatuses.value = {}; tokenBalance.value = null; tokenAllowance.value = null; }
    } catch (error) { loadError.value = message(error); }
    finally { refreshing = false; loading.value = false; }
  }
  async function initialize() {
    try {
      config.value = await api<AppConfig>('/config');
      readProvider.value = new JsonRpcProvider(new URL(config.value.rpcPath, window.location.origin).href, config.value.chainId, { batchMaxCount: config.value.chainId === 31337 ? 10 : 1, cacheTimeout: -1 });
      readProvider.value.pollingInterval = config.value.chainId === 31337 ? 750 : 12000;
      await refresh();
    } catch (error) { loading.value = false; loadError.value = message(error); }
  }
  async function login(wallet: Signer) {
    const walletAddress = await wallet.getAddress();
    const challenge = await api<{ message: string }>('/auth/nonce', { address: walletAddress });
    await api('/auth/verify', { message: challenge.message, signature: await wallet.signMessage(challenge.message) });
    signer.value = wallet; address.value = walletAddress;
    await refresh();
  }
  async function disconnect() {
    detachProvider();
    signer.value = null; address.value = ''; walletStatuses.value = {};
    tokenBalance.value = null; tokenAllowance.value = null;
    try { await api('/auth/logout', {}); } catch {}
  }
  async function connectMetaMask() {
    if (busy.value || walletLoading.value || !config.value) return;
    const injected = discovery.getProvider() ?? (window.ethereum as MetaMaskProvider | undefined);
    if (!injected || typeof injected.request !== 'function') { notify('MetaMask was not detected. Open this app in a browser with the MetaMask extension, then reload. See MetaMask setup for instructions.', 'info'); return; }
    walletLoading.value = true;
    try {
      await injected.request({ method: 'eth_requestAccounts' });
      const chainId = `0x${config.value.chainId.toString(16)}`;
      if (BigInt(await injected.request({ method: 'eth_chainId' }) as string) !== BigInt(config.value.chainId)) {
        try { await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
        catch (error) {
          if ((error as { code?: number }).code !== 4902 || ![31337, 11155111].includes(config.value.chainId)) throw error;
          await injected.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: config.value.chainId === 31337 ? 'Hardhat Local' : 'Sepolia', rpcUrls: [config.value.chainId === 31337 ? 'http://127.0.0.1:8545' : 'https://sepolia.drpc.org'], ...(config.value.chainId === 11155111 ? { blockExplorerUrls: ['https://sepolia.etherscan.io'] } : {}), nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 } }] });
          await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
        }
      }
      const current = new BrowserProvider(injected, undefined, { cacheTimeout: -1 });
      const network = await current.getNetwork();
      if (Number(network.chainId) !== config.value?.chainId) throw new Error('Switch your wallet to the configured network.');
      await disconnect(); await login(await current.getSigner());
      const accounts = await injected.request({ method: 'eth_accounts' }) as string[];
      if (accounts[0]?.toLowerCase() !== address.value.toLowerCase()) throw new Error('The MetaMask account changed during sign-in. Connect again.');
      connectedProvider = injected;
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) injected.on?.(event, onWalletChanged);
      notify('MetaMask connected and sign-in signature verified.', 'success');
    } catch (error) { await disconnect(); notify(message(error), 'error'); }
    finally { walletLoading.value = false; }
  }
  async function checkedContract() {
    if (!signer.value || !config.value || !connectedProvider) throw new Error('Connect MetaMask before continuing.');
    const accounts = await connectedProvider.request({ method: 'eth_accounts' }) as string[];
    if (accounts[0]?.toLowerCase() !== address.value.toLowerCase()) throw new Error('Your MetaMask account changed. Connect again before continuing.');
    const provider = signer.value.provider!;
    if (Number((await provider.getNetwork()).chainId) !== config.value.chainId) throw new Error('The wallet is connected to a different network.');
    const code = await provider.getCode(config.value.contractAddress);
    if (keccak256(code) !== config.value.runtimeCodeHash) throw new Error('The contract does not match this deployment. Restart the local app after resetting the chain.');
    const contract = new Contract(config.value.contractAddress, config.value.abi, signer.value);
    if ((await contract.voteToken()).toLowerCase() !== config.value.tokenAddress.toLowerCase()
      || (await contract.voteCost()).toString() !== config.value.voteCost
      || keccak256(await provider.getCode(config.value.tokenAddress)) !== config.value.tokenRuntimeCodeHash) {
      throw new Error('The voting Token does not match this deployment.');
    }
    return contract;
  }
  async function send(label: string, action: () => Promise<TransactionResponse>, electionId?: number): Promise<TransactionReceipt> {
    await checkedContract();
    transaction.value = { label, phase: 'Confirm in MetaMask', hash: '', electionId };
    const tx = await action();
    transaction.value = { label, phase: 'Waiting for confirmation', hash: tx.hash, electionId };
    let receipt: TransactionReceipt | null;
    try { receipt = await tx.wait(config.value!.chainId === 31337 ? 1 : 2); }
    catch (error) {
      if (isError(error, 'TRANSACTION_REPLACED') && !error.cancelled) receipt = error.receipt;
      else throw error;
    }
    if (!receipt || receipt.status !== 1) throw new Error('Transaction failed. No state change was recorded.');
    transaction.value = { label, phase: 'Confirmed', hash: receipt.hash, electionId };
    return receipt;
  }
  async function vote(election: ElectionView, candidateId: number) {
    if (busy.value) return false;
    busy.value = true;
    transaction.value = null;
    try {
      const contract = await checkedContract();
      const wallet = signer.value!;
      const walletAddress = address.value;
      const [onchain, state] = await contract.getElection(election.id);
      if (!election.rawMetadata || keccak256(toUtf8Bytes(election.rawMetadata)) !== onchain.metadataHash || election.candidateCount !== Number(onchain.candidateCount)) throw new Error('Election metadata could not be verified. Voting is disabled.');
      if (candidateId < 0 || !Number.isInteger(candidateId) || candidateId >= Number(onchain.candidateCount)) throw new Error(errors.InvalidCandidate);
      if (Number(state) !== 2) throw new Error(errors.VotingNotOpen);
      const [eligible, voted] = await contract.getVoterStatus(election.id, walletAddress);
      if (!eligible) throw new Error(errors.NotEligible);
      if (voted) throw new Error(errors.AlreadyVoted);
      const d = config.value!;
      const token = new Contract(d.tokenAddress, d.tokenAbi, wallet);
      const balance = BigInt(await token.balanceOf(walletAddress));
      if (balance < BigInt(d.voteCost)) throw new Error(`Insufficient ${d.tokenSymbol} balance. Each vote requires ${voteCostLabel.value}.`);
      if (BigInt(await token.allowance(walletAddress, d.contractAddress)) < BigInt(d.voteCost)) {
        await send(`Approving ${voteCostLabel.value}`, () => token.approve(d.contractAddress, d.voteCost), election.id);
      }
      await checkedContract();
      if (signer.value !== wallet || address.value !== walletAddress) throw new Error('The wallet account changed. Connect again before voting.');
      await send('Submitting your vote', () => contract.vote(election.id, candidateId), election.id);
      notify(`Your vote is confirmed on-chain. ${voteCostLabel.value} was burned.`, 'success'); await refresh();
      return true;
    } catch (error) { notify(message(error), 'error'); await refresh(); return false; }
    finally { busy.value = false; }
  }
  async function publishPrepared(contract: Contract, electionId: number, draft: PreparedDraft) {
    const [e] = await contract.getElection(electionId);
    if (e.published) return;
    const block = await signer.value!.provider!.getBlock('latest');
    if (Number(e.startsAt) <= block!.timestamp) {
      const start = block!.timestamp + 180;
      await send('Rescheduling the unpublished draft', () => contract.updateDraft(electionId, draft.candidateCount, draft.metadataHash, start, start + (draft.endsAt-draft.startsAt)), electionId);
    }
    for (let i=0; i<draft.wallets.length; i+=50) await send('Registering eligible wallets', () => contract.setEligibility(electionId, draft.wallets.slice(i,i+50), true), electionId);
    await send('Publishing the election', () => contract.publishElection(electionId), electionId);
  }
  async function createElection(body: unknown) {
    if (busy.value) return null;
    busy.value = true;
    let electionId: number | null = null;
    try {
      const contract = await checkedContract();
      const draft = await api<PreparedDraft>('/admin/drafts', body);
      if (keccak256(toUtf8Bytes(draft.rawMetadata)) !== draft.metadataHash) throw new Error('Metadata integrity check failed.');
      const receipt = await send('Creating the election', () => contract.createElection(draft.candidateCount, draft.metadataHash, draft.startsAt, draft.endsAt));
      for (const log of receipt.logs) {
        try { const parsed = contract.interface.parseLog(log); if (parsed?.name === 'ElectionCreated') electionId = Number(parsed.args.electionId); } catch {}
      }
      if (electionId === null) throw new Error('The election ID could not be recovered from its receipt.');
      if (transaction.value) transaction.value.electionId = electionId;
      await publishPrepared(contract, electionId, draft);
      notify('Election published. Its rules and voter list are now frozen.', 'success');
      await refresh(); return electionId;
    } catch (error) {
      notify(`${message(error)}${electionId ? ` Election #${electionId} is saved as a draft; resume it from its details page.` : ''}`, 'error');
      await refresh(); return electionId;
    } finally { busy.value = false; }
  }
  async function resumeElection(id: number) {
    if (busy.value) return;
    busy.value = true;
    try {
      const contract = await checkedContract();
      const draft = await api<PreparedDraft>(`/admin/elections/${id}/resume`, {});
      await publishPrepared(contract, id, draft);
      notify('Election publication completed.', 'success'); await refresh();
    } catch (error) { notify(message(error), 'error'); }
    finally { busy.value = false; }
  }
  async function walletChanged() {
    if (!address.value || walletLoading.value) return;
    await disconnect(); notify('Your MetaMask account or network changed. Connect it again to continue.', 'info');
  }
  function destroy() { detachProvider(); discovery.destroy(); clearTimeout(noticeTimer); readProvider.value?.destroy(); }
  return { config, elections, loading, loadError, address, walletLoading, walletStatuses, notice, transaction, busy, blockNumber,
    metaMaskAvailable, tokenBalance, tokenAllowance, tokenBalanceLabel, voteCostLabel, hasEnoughTokens,
    isAdmin, initialize, refresh, notify, message, connectMetaMask, disconnect, vote, createElection, resumeElection, destroy };
});
