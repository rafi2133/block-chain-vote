import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import hre from 'hardhat';
import { TOM_TOKEN_ADDRESS, TOKEN_ABI, SEPOLIA_CHAIN_ID } from '../../shared/sepolia.js';
import { describeSepoliaDeployment, inspectTomToken } from '../../shared/deployment.js';
import { demoAccounts } from '../../shared/demo.js';

const { ethers } = await hre.network.create();
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const directory = fileURLToPath(new URL('../../shared/deployments/', import.meta.url));
if (![31337, SEPOLIA_CHAIN_ID].includes(chainId)) throw new Error('Only Hardhat Local and Sepolia are supported.');
if (chainId === SEPOLIA_CHAIN_ID) {
  let exists = false;
  try { await access(`${directory}/${chainId}.json`); exists = true; } catch {}
  if (exists) throw new Error('A Sepolia deployment is already saved. Start it with npm run dev:sepolia.');
  await inspectTomToken(ethers.provider);
  const [admin] = await ethers.getSigners();
  if (!admin || demoAccounts.some(account => account.address.toLowerCase() === admin.address.toLowerCase())) throw new Error('Configure your own Sepolia deployment wallet. Never use a public Hardhat account.');
}
const token = chainId === SEPOLIA_CHAIN_ID ? new ethers.Contract(TOM_TOKEN_ADDRESS, TOKEN_ABI, ethers.provider) : await ethers.deployContract('VoteToken');
if (chainId === 31337) await token.waitForDeployment();
const tokenAddress = await token.getAddress();
const voting = await ethers.deployContract('Voting', [tokenAddress]);
await voting.waitForDeployment();
const receipt = await voting.deploymentTransaction()!.wait(chainId === SEPOLIA_CHAIN_ID ? 2 : 1);
const contractAddress = await voting.getAddress();
const code = await ethers.provider.getCode(contractAddress);
const deployment = chainId === SEPOLIA_CHAIN_ID ? await describeSepoliaDeployment(ethers.provider, { abi: JSON.parse(voting.interface.formatJson()), bytecode: (await hre.artifacts.readArtifact('Voting')).bytecode }, receipt!.hash) : {
  deploymentId: randomUUID(), chainId, contractAddress,
  admin: await voting.getFunction('admin')(), deploymentBlock: receipt!.blockNumber,
  deploymentBlockHash: receipt!.blockHash, runtimeCodeHash: ethers.keccak256(code),
  abi: JSON.parse(voting.interface.formatJson()), deployedAt: new Date().toISOString(),
  tokenAddress, tokenAbi: JSON.parse(token.interface.formatJson()),
  tokenRuntimeCodeHash: ethers.keccak256(await ethers.provider.getCode(tokenAddress)),
  tokenSymbol: await token.symbol(), tokenDecimals: Number(await token.decimals()),
  voteCost: (await voting.voteCost()).toString(),
};
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/${chainId}.json`, JSON.stringify(deployment, null, 2), { flag: chainId === SEPOLIA_CHAIN_ID ? 'wx' : 'w' });
console.log(`Voting deployed on chain ${chainId}: ${contractAddress}`);
console.log(`${deployment.tokenSymbol} token: ${tokenAddress}; each successful vote burns 1 ${deployment.tokenSymbol}.`);
