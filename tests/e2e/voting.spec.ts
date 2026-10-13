import { test, expect } from '@playwright/test';
import { Contract } from 'ethers';
import { injectWallet, connectWallet, pendingTransaction, confirmTransaction, rejectTransaction } from './wallet';

const campus = (page: any) => page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Campus improvement fund' }) });

test('lists real elections and shows the completed on-chain tally', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Elections', exact: true })).toBeVisible();
  await expect(page.getByLabel('Demo account')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/workspace.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Student representative' }) }).click();
  await expect(page.getByRole('heading', { name: 'Final results' })).toBeVisible();
  await expect(page.getByText('Selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cast vote' })).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/results.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'All elections', exact: true }).click();
  await campus(page).click();
  await expect(page.getByText('Metadata verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Study commons', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cast vote' })).toBeDisabled();
  await page.screenshot({ path: 'docs/screenshots/voting.png', fullPage: true, animations: 'disabled' });
});

test('requires MetaMask and provides local import instructions when no wallet is installed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect MetaMask', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Connect MetaMask', exact: true }).click();
  await expect(page.getByText('MetaMask was not detected.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'MetaMask setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MetaMask setup', exact: true })).toBeVisible();
  await expect(page.getByText('MetaMask has not been detected in this browser', { exact: true })).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:8545', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Test account to import')).toHaveValue('1');
  await page.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/metamask-setup.png', fullPage: true, animations: 'disabled' });
});

test('uses the injected wallet for approval and voting, preserves rejected requests, and burns one token', async ({ page }) => {
  const f = await injectWallet(page, 1, { switchNetwork: true });
  try {
    await page.goto('/'); await connectWallet(page);
    const methods = await page.evaluate(() => (window as any).__walletTest.requests.map((r: any) => r.method));
    expect(methods).toContain('eth_requestAccounts');
    expect(methods).toContain('personal_sign');
    expect(methods).toContain('wallet_addEthereumChain');
    expect(methods).toContain('wallet_switchEthereumChain');
    await campus(page).click();
    await expect(page.getByTestId('token-balance')).toHaveText('99 VOTE');
    const token = new Contract(f.config.tokenAddress, f.config.tokenAbi, f.rpc);
    const voting = new Contract(f.config.contractAddress, f.config.abi, f.rpc);
    const supply = await token.totalSupply();
    const nonce = await f.rpc.getTransactionCount(f.wallet.address);
    await page.getByRole('radio', { name: 'Study commons' }).check();
    await page.getByRole('button', { name: 'Cast vote' }).click();
    const approval = await pendingTransaction(page);
    expect(approval.to.toLowerCase()).toBe(f.config.tokenAddress.toLowerCase());
    const decoded = token.interface.parseTransaction({ data: approval.data })!;
    expect(decoded.name).toBe('approve');
    expect(decoded.args[0].toLowerCase()).toBe(f.config.contractAddress.toLowerCase());
    expect(decoded.args[1]).toBe(10n ** 18n);
    await expect(page.getByText('Confirm in MetaMask', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await rejectTransaction(page);
    await expect(page.getByRole('button', { name: 'Cast vote' })).toBeEnabled();
    expect(await f.rpc.getTransactionCount(f.wallet.address)).toBe(nonce);
    expect(await token.allowance(f.wallet.address, f.config.contractAddress)).toBe(0n);
    expect(await token.totalSupply()).toBe(supply);

    await page.getByRole('button', { name: 'Cast vote' }).click();
    await confirmTransaction(page);
    const vote = await pendingTransaction(page);
    expect(vote.to.toLowerCase()).toBe(f.config.contractAddress.toLowerCase());
    expect(voting.interface.parseTransaction({ data: vote.data })!.name).toBe('vote');
    await rejectTransaction(page);
    await expect(page.getByRole('button', { name: 'Cast vote' })).toBeEnabled();
    await expect(page.getByTestId('token-balance')).toHaveText('99 VOTE');
    expect(await token.allowance(f.wallet.address, f.config.contractAddress)).toBe(10n ** 18n);
    expect(await token.totalSupply()).toBe(supply);
    expect(await voting.hasVoted(2, f.wallet.address)).toBe(false);

    await page.getByRole('button', { name: 'Cast vote' }).click();
    const finalVote = await pendingTransaction(page);
    expect(finalVote.to.toLowerCase()).toBe(f.config.contractAddress.toLowerCase());
    await confirmTransaction(page);
    await expect(page.getByRole('button', { name: 'Vote recorded' })).toBeDisabled();
    await expect(page.getByTestId('token-balance')).toHaveText('98 VOTE');
    expect(await token.totalSupply()).toBe(supply - 10n ** 18n);
    expect(await token.allowance(f.wallet.address, f.config.contractAddress)).toBe(0n);
    await expect(page.getByText('Transaction confirmed', { exact: true })).toBeVisible();
    await expect(page.getByText('2 of 3 eligible wallets have voted')).toBeVisible();
    await page.getByRole('link', { name: 'All elections', exact: true }).click();
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: 'Student representative' }) }).click();
    await expect(page.getByText('Transaction confirmed', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).__walletTest.changeAccount());
    await expect(page.getByRole('button', { name: 'Connect MetaMask', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect wallet' })).toHaveCount(0);
  } finally { f.close(); }
});

test('the legacy MetaMask provider cannot vote with an unregistered account', async ({ page }) => {
  const f = await injectWallet(page, 4, { legacy: true });
  try {
    await page.goto('/'); await connectWallet(page); await campus(page).click();
    await expect(page.getByText('This wallet is not on the eligible voter list.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cast vote' })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__walletTest.requests.some((r: any) => r.method === 'eth_sendTransaction'))).toBe(false);
  } finally { f.close(); }
});

test('an eligible MetaMask account without tokens cannot start a vote', async ({ page }) => {
  const f = await injectWallet(page, 2);
  const token = new Contract(f.config.tokenAddress, f.config.tokenAbi, await f.rpc.getSigner(f.wallet.address));
  const balance = await token.balanceOf(f.wallet.address);
  try {
    await (await token.transfer(f.config.admin, balance)).wait();
    await page.goto('/'); await connectWallet(page); await campus(page).click();
    await expect(page.getByText('Insufficient VOTE balance. You need 1 VOTE to cast a vote.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('token-balance')).toHaveText('0 VOTE');
    await expect(page.getByRole('button', { name: 'Cast vote' })).toBeDisabled();
    expect(await new Contract(f.config.contractAddress, f.config.abi, f.rpc).hasVoted(2, f.wallet.address)).toBe(false);
  } finally {
    await (await token.connect(await f.rpc.getSigner(f.config.admin)).getFunction('transfer')(f.wallet.address, balance)).wait();
    f.close();
  }
});

test('administrator confirms all three publication transactions through the wallet provider', async ({ page }) => {
  const f = await injectWallet(page, 0);
  try {
    await page.goto('/'); await connectWallet(page);
    await page.getByRole('link', { name: 'Create election', exact: true }).first().click();
    await page.getByLabel('Election title', { exact: true }).fill('Library weekend hours');
    await page.getByLabel('Description', { exact: true }).fill('Choose the preferred library opening schedule.');
    await page.getByLabel('Candidate 1 name', { exact: true }).fill('Saturday mornings');
    await page.getByLabel('Candidate 2 name', { exact: true }).fill('Sunday afternoons');
    await page.getByRole('button', { name: 'Create & publish' }).click();
    for (let i = 0; i < 3; i++) await confirmTransaction(page);
    await expect(page.getByRole('heading', { name: 'Library weekend hours', exact: true })).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('Voting opens at the scheduled start time.', { exact: true })).toBeVisible();
    await expect(page.getByText('Metadata verified', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume publication' })).toHaveCount(0);
  } finally { f.close(); }
});

test('mobile navigation and the MetaMask setup page fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Elections', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'MetaMask setup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MetaMask setup', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/metamask-setup-mobile.png', fullPage: true, animations: 'disabled' });
});
