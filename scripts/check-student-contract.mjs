import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../contracts/contracts/Voting.sol', import.meta.url)), 'utf8');
const pending = [...source.matchAll(/revert\s+StudentImplementationRequired\s*\(\s*(\d+)\s*\)/g)].map(match => `SC-0${match[1]}`);
if (pending.length) {
  console.error(`Complete these Voting.sol tasks first: ${pending.join(', ')}.`);
  console.error('Run npm run test:tasks to see the requirements. Then run npm run verify.');
  process.exit(1);
}
console.log('All three placeholder reverts have been removed. Contract tests must still pass.');
