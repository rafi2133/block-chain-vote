import { Contract, ContractFactory, Interface, ZeroAddress, getAddress, keccak256, type AbstractProvider, type JsonFragment } from 'ethers';
import { randomUUID } from 'node:crypto';
import type { Deployment } from './types.js';
import { SEPOLIA_CHAIN_ID, TOKEN_ABI, TOM_TOKEN_ADDRESS } from './sepolia.js';
import { demoAccounts } from './demo.js';

export interface VotingArtifact { abi: JsonFragment[]; bytecode: string }

export async function inspectTomToken(provider: AbstractProvider) {
  if (Number((await provider.getNetwork()).chainId) !== SEPOLIA_CHAIN_ID) throw new Error('RPC must connect to Ethereum Sepolia (11155111).');
  const code = await provider.getCode(TOM_TOKEN_ADDRESS);
  if (code === '0x') throw new Error('Tom Token was not found on Sepolia.');
  const token = new Contract(TOM_TOKEN_ADDRESS, TOKEN_ABI, provider);
  const [name, symbol, decimals] = await Promise.all([token.name(), token.symbol(), token.decimals()]);
  if (name !== 'Tom Token' || symbol !== 'TOM' || Number(decimals) !== 18) throw new Error('Unexpected Tom Token metadata.');
  // eth_call simulates a zero-value burn, without altering balances or supply.
  await provider.call({ from: '0x0000000000000000000000000000000000000001', to: TOM_TOKEN_ADDRESS,
    data: token.interface.encodeFunctionData('burnFrom', ['0x0000000000000000000000000000000000000001', 0]) });
  return { tokenName: name as string, tokenSymbol: symbol as string, tokenDecimals: Number(decimals), tokenRuntimeCodeHash: keccak256(code), voteCost: '1000000000000000000' };
}

export async function describeSepoliaDeployment(provider: AbstractProvider, artifact: VotingArtifact, hash: string): Promise<Deployment> {
  const tokenInfo = await inspectTomToken(provider);
  const [tx, receipt, latest] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash), provider.getBlockNumber()]);
  if (!tx || !receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('A successful contract deployment receipt is required.');
  if (latest - receipt.blockNumber + 1 < 2) throw new Error('Wait for at least two Sepolia confirmations, then finish setup again.');
  const block = await provider.getBlock(receipt.blockNumber);
  if (block?.hash !== receipt.blockHash) throw new Error('Deployment receipt is no longer on the canonical chain.');
  if (tx.to !== null || Number(tx.chainId) !== SEPOLIA_CHAIN_ID) throw new Error('Transaction must directly deploy a contract on Sepolia.');
  if (demoAccounts.some(account => account.address.toLowerCase() === tx.from.toLowerCase())) throw new Error('Use your own Sepolia wallet, not a public Hardhat account.');
  const expected = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(TOM_TOKEN_ADDRESS);
  if (tx.data.toLowerCase() !== expected.data!.toLowerCase()) throw new Error('Deployment bytecode or Tom Token constructor address does not match this project.');
  const contractAddress = getAddress(receipt.contractAddress);
  const voting = new Contract(contractAddress, artifact.abi, provider);
  const [admin, tokenAddress, voteCost, code] = await Promise.all([voting.admin(), voting.voteToken(), voting.voteCost(), provider.getCode(contractAddress)]);
  if (getAddress(admin) !== getAddress(tx.from) || getAddress(tokenAddress) !== TOM_TOKEN_ADDRESS || voteCost.toString() !== tokenInfo.voteCost || code === '0x' || admin === ZeroAddress) {
    throw new Error('Deployed voting rules or administrator do not match the confirmed transaction.');
  }
  return { deploymentId: randomUUID(), chainId: SEPOLIA_CHAIN_ID, contractAddress, admin: getAddress(admin),
    deploymentBlock: receipt.blockNumber, deploymentBlockHash: receipt.blockHash, runtimeCodeHash: keccak256(code),
    abi: artifact.abi, deployedAt: new Date().toISOString(), deploymentTransactionHash: hash,
    tokenAddress: TOM_TOKEN_ADDRESS, tokenAbi: JSON.parse(new Interface(TOKEN_ABI).formatJson()), ...tokenInfo };
}
