import { HDNodeWallet } from 'ethers';
// Public Hardhat development mnemonic. These accounts must NEVER hold real funds.
// Used by the local seed, server address listing, and tests; never a browser signer.
export const DEMO_MNEMONIC = 'test test test test test test test test test test test junk';
export function demoWallet(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 4) throw new Error('Invalid demo account');
  return HDNodeWallet.fromPhrase(DEMO_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
}
export const demoAccounts = Array.from({ length: 5 }, (_, index) => ({
  index, address: demoWallet(index).address,
  label: ['Administrator', 'Voter 01', 'Voter 02', 'Voter 03', 'Unregistered voter'][index]!,
}));
