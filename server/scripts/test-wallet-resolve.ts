/**
 * Test whether Xeet/MVC APIs resolve a wallet address to an xHandle.
 *
 * Usage:
 *   npx tsx scripts/test-wallet-resolve.ts 0xd26CedEa416d39866Ee8Ca18b21c188dba75568f
 */

const wallet = process.argv[2];
if (!wallet) {
  console.error('Usage: npx tsx scripts/test-wallet-resolve.ts <wallet_address>');
  process.exit(1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const endpoints = [
  `https://www.xeet.ai/api/user/handle/${wallet}/header`,
  `https://www.xeet.ai/api/user/${wallet}/header`,
  `https://www.xeet.ai/api/user/wallet/${wallet}`,
  `https://www.xeet.ai/api/user/${wallet}`,
  `https://xeet.mvc-web.xyz/api/users/${wallet}`,
];

async function main() {
  console.log('Testing wallet resolution for: %s\n', wallet);

  for (const url of endpoints) {
    console.log('═'.repeat(72));
    console.log('  GET %s', url);
    console.log('═'.repeat(72));

    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log('  Status: %d %s', res.status, res.statusText);

      if (res.ok) {
        const data = await res.json();
        const raw = JSON.stringify(data, null, 2);
        console.log(raw);

        // Flag fields containing handle/username/name
        const flat = JSON.stringify(data);
        const flags: string[] = [];
        if (/"xHandle"/.test(flat)) flags.push('xHandle');
        if (/"username"/.test(flat)) flags.push('username');
        if (/"displayName"/.test(flat)) flags.push('displayName');
        if (/"walletAddress"/.test(flat)) flags.push('walletAddress');
        if (flags.length > 0) {
          console.log('\n  → Found fields: %s', flags.join(', '));
        }
      } else {
        const text = await res.text();
        console.log('  Body: %s', text.slice(0, 300));
      }
    } catch (err) {
      console.log('  Error: %s', err);
    }

    console.log();
    await sleep(500);
  }
}

main().catch(console.error);
