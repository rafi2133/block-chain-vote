import { test, expect } from '@playwright/test';
import { ContractFactory, keccak256, parseEther } from 'ethers';

const url = process.env.SEPOLIA_URL;
test.describe('Sepolia setup', () => {
  test.skip(!url, 'Run with SEPOLIA_URL against the Sepolia setup service.');
  test('verifies the existing TOM token and requires a MetaMask deployment confirmation', async ({ page }) => {
    await page.goto(`${url}/sepolia`);
    await expect(page.getByRole('heading', { name: 'Deploy to Sepolia' })).toBeVisible();
    await expect(page.getByText('Token metadata and burnFrom simulation verified on Sepolia.')).toBeVisible();
    await expect(page.getByText('1 TOM burned on success', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deploy with MetaMask' })).toBeDisabled();
    await page.screenshot({ path: 'docs/screenshots/sepolia-setup.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Connect MetaMask on Sepolia' }).click();
    await expect(page.getByText('Open this page in a browser with MetaMask installed and unlocked.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deploy with MetaMask' })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'docs/screenshots/sepolia-setup-mobile.png', fullPage: true, animations: 'disabled' });
  });
  test('rejects other origins and malformed deployment receipts', async ({ request }) => {
    const denied = await request.post(`${url}/api/sepolia/complete`, { data: { transactionHash: `0x${'12'.repeat(32)}` }, headers: { Origin: 'https://example.invalid' } });
    expect(denied.status()).toBe(403);
    const malformed = await request.post(`${url}/api/sepolia/complete`, { data: { transactionHash: 'invalid' }, headers: { Origin: url! } });
    expect(malformed.status()).toBe(400);
    const status = await request.get(`${url}/api/sepolia/status`);
    expect(await status.json()).toEqual({ ready: false, chainId: 11155111 });
  });
  test('prevents use of a public Hardhat account on Sepolia', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).ethereum = { isMetaMask: true, request: async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'wallet_switchEthereumChain') return null;
        throw new Error(`Unexpected wallet request: ${method}`);
      } };
    });
    await page.goto(`${url}/sepolia`);
    await expect(page.getByRole('button', { name: 'Connect MetaMask on Sepolia' })).toBeEnabled();
    await page.getByRole('button', { name: 'Connect MetaMask on Sepolia' }).click();
    await expect(page.getByText('Connect your own Sepolia wallet. Public Hardhat test accounts cannot deploy this application.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deploy with MetaMask' })).toBeDisabled();
  });
  test('asks MetaMask to deploy the exact voting bytecode with TOM, and preserves rejection', async ({ page, request }) => {
    const plan = await (await request.get(`${url}/api/sepolia/plan`)).json();
    // Controlled provider double: no Sepolia transaction is broadcast.
    const code = '0x60006000';
    await page.route('**/api/sepolia/plan', route => route.fulfill({ json: { ...plan, tokenRuntimeCodeHash: keccak256(code) } }));
    await page.addInitScript(({ code, balance }) => {
      (window as any).__deploymentRequests = [];
      (window as any).ethereum = { isMetaMask: true, request: async ({ method, params }: { method: string; params: any[] }) => {
        (window as any).__deploymentRequests.push({ method, params });
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x0000000000000000000000000000000000000011'];
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'wallet_switchEthereumChain') return null;
        if (method === 'eth_getCode') return code;
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getBalance') return balance;
        if (method === 'eth_call') return params[0].data.startsWith('0x79cc6790') ? '0x' : '0x'+BigInt(balance).toString(16).padStart(64, '0');
        if (method === 'eth_estimateGas') return '0x3d0900';
        if (method === 'eth_sendTransaction') throw Object.assign(new Error('User rejected deployment'), { code: 4001 });
        throw new Error(`Unexpected wallet request: ${method}`);
      } };
    }, { code, balance: `0x${parseEther('1').toString(16)}` });
    await page.goto(`${url}/sepolia`);
    await page.getByRole('button', { name: 'Connect MetaMask on Sepolia' }).click();
    const deploy = page.getByRole('button', { name: 'Deploy with MetaMask' });
    await expect(deploy).toBeEnabled(); await deploy.click();
    await expect(deploy).toBeEnabled();
    await expect(page.getByText('MetaMask request rejected.', { exact: false })).toBeVisible();
    await expect(deploy).toBeEnabled();
    const calls = await page.evaluate(() => (window as any).__deploymentRequests);
    const sent = calls.find((call: any) => call.method === 'eth_sendTransaction').params[0];
    const expected = await new ContractFactory(plan.abi, plan.bytecode).getDeployTransaction(plan.tokenAddress);
    expect(sent.data).toBe(expected.data);
    expect(sent.to).toBeUndefined();
    expect(sent.from.toLowerCase()).toBe('0x0000000000000000000000000000000000000011');
    expect(await page.evaluate(() => localStorage.getItem('ballot-sepolia-deployment'))).toBeNull();
  });
});
