// Quick: pull the 'from' address of every unique mint tx via eth_getTransactionByHash batched
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const KEY = env.ETHERSCAN_API_KEY;
const events = JSON.parse(fs.readFileSync(path.join(__dirname, 'megaeth-raw-events.json'), 'utf8'));
const ZERO = '0x' + '0'.repeat(40);

const mintTxs = new Set();
for (const e of events) if ((e.from || '').toLowerCase() === ZERO) mintTxs.add(e.hash);
const txArr = [...mintTxs];
console.log(`Total unique mint txs: ${txArr.length}`);
console.log('Querying tx initiators (5 req/s)...');

const fromCount = new Map();
const toCount = new Map();
let queried = 0;

for (const tx of txArr) {
  try {
    const r = await fetch(`https://api.etherscan.io/v2/api?chainid=4326&module=proxy&action=eth_getTransactionByHash&txhash=${tx}&apikey=${KEY}`);
    const j = await r.json();
    const result = j.result;
    if (result) {
      const from = (result.from || '').toLowerCase();
      const to = (result.to || '').toLowerCase();
      fromCount.set(from, (fromCount.get(from) || 0) + 1);
      toCount.set(to, (toCount.get(to) || 0) + 1);
    }
    queried++;
    if (queried % 100 === 0) console.log(`  ${queried}/${txArr.length}`);
  } catch (e) { /* continue */ }
  await new Promise(r => setTimeout(r, 200));
}

console.log(`\nDistinct mint-tx initiators (from):`);
for (const [addr, count] of [...fromCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${addr}  ${count} txs`);
}
console.log(`\nDistinct mint-tx targets (to):`);
for (const [addr, count] of [...toCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${addr}  ${count} txs`);
}

fs.writeFileSync(
  path.join(__dirname, 'relayer-distribution.json'),
  JSON.stringify({
    total_mint_txs: txArr.length,
    queried,
    initiators: Object.fromEntries(fromCount),
    targets: Object.fromEntries(toCount),
  }, null, 2)
);
