import type { Eip1193Provider } from 'ethers';

export interface MetaMaskProvider extends Eip1193Provider {
  isMetaMask?: boolean;
  providers?: MetaMaskProvider[];
  name?: string;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
}

function isMetaMaskProvider(candidate?: MetaMaskProvider) {
  if (!candidate || typeof candidate.request !== 'function') return false;
  return !!(candidate.isMetaMask || candidate.name?.toLowerCase() === 'metamask' || candidate.name?.toLowerCase() === 'metamask wallet');
}

// EIP-6963 selects MetaMask when several extensions share window.ethereum.
// Provider names and flags are self-reported discovery hints, not identity proofs.
export function discoverMetaMask(onChange: (available: boolean) => void) {
  let announced: MetaMaskProvider | undefined;
  function legacy() {
    const injected = window.ethereum as MetaMaskProvider | undefined;
    return injected?.providers?.find(provider => isMetaMaskProvider(provider))
      ?? (isMetaMaskProvider(injected) ? injected : undefined);
  }
  function announce(event: Event) {
    const detail = (event as CustomEvent<{ info?: { rdns?: string; name?: string }; provider?: MetaMaskProvider }>).detail;
    const candidate = detail?.provider;
    if ((detail?.info?.rdns === 'io.metamask' || detail?.info?.name?.toLowerCase() === 'metamask') && typeof candidate?.request === 'function') {
      announced = candidate;
      onChange(true);
    }
  }
  function update() { onChange(!!(announced ?? legacy())); }
  function request() {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    update();
  }
  window.addEventListener('eip6963:announceProvider', announce);
  window.addEventListener('ethereum#initialized', update);
  request();
  return {
    getProvider() { request(); return announced ?? legacy(); },
    destroy() {
      window.removeEventListener('eip6963:announceProvider', announce);
      window.removeEventListener('ethereum#initialized', update);
    },
  };
}
