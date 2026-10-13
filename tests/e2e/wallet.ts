import { expect, type Page } from '@playwright/test';
import { JsonRpcProvider, getBytes } from 'ethers';
import { demoWallet } from '../../shared/demo.js';

// A controllable EIP-1193 test double. This is not the MetaMask extension.
// The app still uses its actual BrowserProvider / JsonRpcSigner transaction path.
export async function injectWallet(page: Page, index: number, options: { legacy?: boolean; switchNetwork?: boolean } = {}) {
  const config = await (await page.request.get('/api/config')).json();
  if (config.chainId !== 31337) throw new Error('Wallet integration tests are restricted to Hardhat Local.');
  const wallet = demoWallet(index);
  const rpc = new JsonRpcProvider('http://127.0.0.1:8545', 31337, { cacheTimeout: -1 });
  rpc.pollingInterval = 100;
  const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getLogs']);
  await page.exposeFunction('__testWalletRpc', async (request: { method: string; params?: unknown[] }) => {
    const params = request.params ?? [];
    if (request.method === 'personal_sign') {
      if (String(params[1]).toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Wrong signing account');
      return wallet.signMessage(getBytes(String(params[0])));
    }
    if (request.method === 'eth_sendTransaction') {
      const tx = params[0] as { from: string; to: string };
      if (tx.from.toLowerCase() !== wallet.address.toLowerCase()
        || ![config.contractAddress.toLowerCase(), config.tokenAddress.toLowerCase()].includes(tx.to.toLowerCase())) throw new Error('Unexpected test transaction');
      return rpc.send(request.method, params);
    }
    if (!readMethods.has(request.method)) throw new Error(`Unexpected wallet RPC: ${request.method}`);
    return rpc.send(request.method, params);
  });
  await page.addInitScript(({ address, legacy, switchNetwork }) => {
    const w = window as any;
    let authorized = false;
    let chainId = switchNetwork ? '0x1' : '0x7a69';
    let networkAdded = !switchNetwork;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: { method: string; params?: any[] }[] = [];
    let pending: { request: any; resolve: (result: any) => void; reject: (error: any) => void } | null = null;
    w.__walletTest = {
      requests,
      get pending() { return pending?.request ?? null; },
      confirm() {
        if (!pending) throw new Error('No pending wallet request');
        const current = pending; pending = null;
        w.__testWalletRpc(current.request).then(current.resolve, current.reject);
      },
      reject() {
        if (!pending) throw new Error('No pending wallet request');
        const current = pending; pending = null;
        current.reject({ code: 4001, message: 'User rejected the request.' });
      },
      changeAccount() {
        authorized = false;
        listeners.get('accountsChanged')?.forEach(listener => listener([]));
      },
    };
    const provider = {
      isMetaMask: true,
      on(event: string, listener: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
      async request(request: { method: string; params?: any[] }) {
        requests.push(request);
        if (request.method === 'eth_requestAccounts') { authorized = true; return [address]; }
        if (request.method === 'eth_accounts') return authorized ? [address] : [];
        if (request.method === 'eth_chainId') return chainId;
        if (request.method === 'wallet_switchEthereumChain') {
          if (!networkAdded) throw { code: 4902, message: 'Unknown network' };
          chainId = request.params![0].chainId; return null;
        }
        if (request.method === 'wallet_addEthereumChain') { networkAdded = true; return null; }
        if (request.method === 'eth_sendTransaction') {
          if (pending) throw { code: -32002, message: 'Request already pending' };
          return new Promise((resolve, reject) => { pending = { request, resolve, reject }; });
        }
        return w.__testWalletRpc(request);
      },
    };
    if (legacy) w.ethereum = provider;
    else {
      w.ethereum = { isMetaMask: false, request: () => { throw new Error('The unrelated wallet must not be used.'); } };
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: { uuid: '00cc1fdd-9b45-4d17-a3f1-000000000001', name: 'MetaMask', rdns: 'io.metamask', icon: '' }, provider }),
      }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    }
  }, { address: wallet.address, legacy: options.legacy ?? false, switchNetwork: options.switchNetwork ?? false });
  return { config, wallet, rpc, close: () => rpc.destroy() };
}

export async function connectWallet(page: Page) {
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toBeVisible();
}
export async function pendingTransaction(page: Page) {
  await expect.poll(() => page.evaluate(() => !!(window as any).__walletTest.pending)).toBe(true);
  return page.evaluate(() => (window as any).__walletTest.pending.params[0]) as Promise<{ to: string; from: string; data: string }>;
}
export async function confirmTransaction(page: Page) {
  await pendingTransaction(page);
  await page.evaluate(() => (window as any).__walletTest.confirm());
}
export async function rejectTransaction(page: Page) {
  await pendingTransaction(page);
  await page.evaluate(() => (window as any).__walletTest.reject());
}
