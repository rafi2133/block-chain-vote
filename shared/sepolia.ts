import type { JsonFragment } from 'ethers';

export const SEPOLIA_CHAIN_ID = 11155111;
export const TOM_TOKEN_ADDRESS = '0xE2311e42e7685f097efCf96aF6CeEF11d5Adbe54';
export const SEPOLIA_PUBLIC_RPC = 'https://sepolia.drpc.org';
export const TOKEN_ABI = [
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function burnFrom(address,uint256)',
  'error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)',
  'error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)',
];
export interface SepoliaPlan {
  chainId: number; tokenAddress: string; tokenName: string; tokenSymbol: string;
  tokenDecimals: number; tokenRuntimeCodeHash: string; voteCost: string;
  abi: JsonFragment[]; bytecode: string; publicRpcUrl: string;
  existingTransactionHash: string | null;
}
