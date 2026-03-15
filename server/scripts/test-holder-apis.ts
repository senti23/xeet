/**
 * Smoke test: validate Abscan and Alchemy API keys work for holder data.
 *
 * Usage:
 *   npx tsx scripts/test-holder-apis.ts
 */

import '../src/config.js';
import { config } from '../src/config.js';

const CONTRACT = config.opensea.contract;

async function testAbscan(): Promise<void> {
  console.log('\n=== ABSCAN API TEST ===');
  if (!config.abscan.apiKey) {
    console.log('  SKIP: No ABSCAN_API_KEY set in .env');
    return;
  }

  const url = `${config.abscan.baseUrl}?module=account&action=token1155tx&contractaddress=${CONTRACT}&startblock=0&endblock=99999999&page=1&offset=5&sort=asc&apikey=${config.abscan.apiKey}`;
  console.log(`  Fetching: ${config.abscan.baseUrl}?module=account&action=token1155tx&...`);

  try {
    const res = await fetch(url);
    console.log(`  HTTP status: ${res.status}`);

    const data = await res.json() as any;
    console.log(`  API status: ${data.status}`);
    console.log(`  API message: ${data.message}`);

    if (data.status === '1' && Array.isArray(data.result)) {
      console.log(`  Results: ${data.result.length} transfer events`);
      if (data.result.length > 0) {
        const tx = data.result[0];
        console.log(`  Sample transfer:`);
        console.log(`    Block:    ${tx.blockNumber}`);
        console.log(`    From:     ${tx.from}`);
        console.log(`    To:       ${tx.to}`);
        console.log(`    TokenID:  ${tx.tokenID}`);
        console.log(`    Value:    ${tx.tokenValue}`);
        console.log(`    Hash:     ${tx.hash}`);
        console.log(`    Time:     ${new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString()}`);
      }
      console.log('  PASS: Abscan ERC-1155 transfer events working');
    } else {
      console.log(`  FAIL: Unexpected response: ${JSON.stringify(data.result).slice(0, 200)}`);
    }

    // Also test pagination — fetch page 2 to estimate total count
    const url2 = `${config.abscan.baseUrl}?module=account&action=token1155tx&contractaddress=${CONTRACT}&startblock=0&endblock=99999999&page=1&offset=10000&sort=asc&apikey=${config.abscan.apiKey}`;
    console.log('\n  Fetching page with offset=10000 to estimate total transfers...');
    const res2 = await fetch(url2);
    const data2 = await res2.json() as any;
    if (data2.status === '1' && Array.isArray(data2.result)) {
      console.log(`  First page size: ${data2.result.length}`);
      if (data2.result.length === 10000) {
        console.log('  Note: 10000 results = there are MORE pages (will need pagination)');
      } else {
        console.log(`  Total transfers fit in one page: ${data2.result.length}`);
      }
    }
  } catch (err) {
    console.log(`  FAIL: ${err}`);
  }
}

async function testAlchemy(): Promise<void> {
  console.log('\n=== ALCHEMY NFT API TEST ===');
  if (!config.alchemy.apiKey) {
    console.log('  SKIP: No ALCHEMY_API_KEY set in .env');
    return;
  }

  // Test getOwnersForNFT endpoint
  const url = `https://abstract-mainnet.g.alchemy.com/nft/v3/${config.alchemy.apiKey}/getOwnersForNFT?contractAddress=${CONTRACT}&tokenId=1`;
  console.log(`  Fetching: getOwnersForNFT for token ID 1...`);

  try {
    const res = await fetch(url);
    console.log(`  HTTP status: ${res.status}`);

    if (res.ok) {
      const data = await res.json() as any;
      console.log(`  Owners count: ${data.owners?.length ?? 'N/A'}`);
      if (data.owners?.length > 0) {
        console.log(`  Sample owners: ${data.owners.slice(0, 3).join(', ')}`);
      }
      console.log('  PASS: Alchemy getOwnersForNFT working on Abstract');
    } else {
      const text = await res.text();
      console.log(`  FAIL: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL: ${err}`);
  }

  // Test getOwnersForContract endpoint
  const url2 = `https://abstract-mainnet.g.alchemy.com/nft/v3/${config.alchemy.apiKey}/getOwnersForContract?contractAddress=${CONTRACT}&withTokenBalances=true&limit=5`;
  console.log(`\n  Fetching: getOwnersForContract (first 5 owners)...`);

  try {
    const res = await fetch(url2);
    console.log(`  HTTP status: ${res.status}`);

    if (res.ok) {
      const data = await res.json() as any;
      console.log(`  Owners in this page: ${data.owners?.length ?? 'N/A'}`);
      if (data.owners?.length > 0) {
        const owner = data.owners[0];
        console.log(`  Sample owner: ${owner.ownerAddress}`);
        console.log(`  Token balances: ${owner.tokenBalances?.length ?? 0} tokens`);
        if (owner.tokenBalances?.length > 0) {
          const tb = owner.tokenBalances[0];
          console.log(`    Token ${tb.tokenId}: balance ${tb.balance}`);
        }
      }
      console.log('  PASS: Alchemy getOwnersForContract working on Abstract');
    } else {
      const text = await res.text();
      console.log(`  FAIL: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.log(`  FAIL: ${err}`);
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log('  HOLDER API SMOKE TEST');
  console.log('════════════════════════════════════════════════════════════════════════');
  console.log(`  Contract: ${CONTRACT}`);
  console.log(`  Abscan key: ${config.abscan.apiKey ? config.abscan.apiKey.slice(0, 8) + '...' : 'NOT SET'}`);
  console.log(`  Alchemy key: ${config.alchemy.apiKey ? config.alchemy.apiKey.slice(0, 8) + '...' : 'NOT SET'}`);

  await testAbscan();
  await testAlchemy();

  console.log('\n════════════════════════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log('════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
