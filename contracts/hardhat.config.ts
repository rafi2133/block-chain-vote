import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, configVariable } from 'hardhat/config';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import hardhatMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';

const require = createRequire(import.meta.url);
const envPath = fileURLToPath(new URL('../.env.sepolia', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, hardhatMatchers],
  solidity: {
    version: '0.8.30', path: require.resolve('solc/soljson.js'), preferWasm: true,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'shanghai' },
  },
  networks: {
    localhost: { type: 'http', chainType: 'l1', url: 'http://127.0.0.1:8545', chainId: 31337 },
    sepolia: {
      type: 'http', chainType: 'l1', chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || 'https://sepolia.drpc.org', accounts: [configVariable('SEPOLIA_PRIVATE_KEY')],
    },
  },
});
