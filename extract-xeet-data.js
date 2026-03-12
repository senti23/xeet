const https = require('https');
const http = require('http');
const fs = require('fs');

// Config
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;

function fetch(url, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          if (retries > 0) {
            setTimeout(() => fetch(url, retries - 1).then(resolve).catch(reject), 2000);
            return;
          }
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', (e) => {
      if (retries > 0) {
        setTimeout(() => fetch(url, retries - 1).then(resolve).catch(reject), 2000);
      } else {
        resolve(null);
      }
    });
    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) {
        setTimeout(() => fetch(url, retries - 1).then(resolve).catch(reject), 2000);
      } else {
        resolve(null);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runBatches(items, fn, label) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(items.length / BATCH_SIZE);
    process.stderr.write(`\r${label}: batch ${batchNum}/${totalBatches} (${i + batch.length}/${items.length})`);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + BATCH_SIZE < items.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  process.stderr.write(`\n`);
  return results;
}

async function main() {
  console.error('=== Xeet Creator Cards Data Extraction ===\n');

  // Step 1: Pull all creators from paginated list
  console.error('Step 1: Pulling creator list (20 pages)...');
  const allCreators = [];
  const pages = Array.from({ length: 20 }, (_, i) => i + 1);
  const pageResults = await runBatches(pages, async (page) => {
    const data = await fetch(`https://xeet.mvc-web.xyz/api/creators?page=${page}&limit=20`);
    return data;
  }, 'Pages');

  for (const pageData of pageResults) {
    if (pageData && pageData.data) {
      allCreators.push(...pageData.data);
    } else if (pageData && Array.isArray(pageData)) {
      allCreators.push(...pageData);
    }
  }
  console.error(`Collected ${allCreators.length} creators from list\n`);

  // Extract xHandles
  const handles = allCreators.map(c => c.xHandle).filter(Boolean);
  console.error(`${handles.length} creators have xHandles\n`);

  // Step 2: Get individual creator details from Source 1
  console.error('Step 2: Enriching creator details from mvc-web.xyz...');
  const creatorDetails = {};
  const detailResults = await runBatches(handles, async (handle) => {
    const data = await fetch(`https://xeet.mvc-web.xyz/api/creators/${encodeURIComponent(handle)}`);
    return { handle, data };
  }, 'Creator details');

  for (const { handle, data } of detailResults) {
    if (data) {
      creatorDetails[handle.toLowerCase()] = data;
    }
  }
  console.error(`Got details for ${Object.keys(creatorDetails).length} creators\n`);

  // Step 3: Pull Xeet platform data from Source 2
  console.error('Step 3: Pulling xeet.ai header data...');
  const xeetHeaders = {};
  const headerResults = await runBatches(handles, async (handle) => {
    const data = await fetch(`https://www.xeet.ai/api/user/handle/${encodeURIComponent(handle)}/header`);
    return { handle, data };
  }, 'Xeet headers');

  for (const { handle, data } of headerResults) {
    if (data && data.data) {
      xeetHeaders[handle.toLowerCase()] = data.data;
    }
  }
  console.error(`Got xeet headers for ${Object.keys(xeetHeaders).length} creators\n`);

  console.error('Step 4: Pulling xeet.ai tournament data...');
  const xeetTournaments = {};
  const tourneyResults = await runBatches(handles, async (handle) => {
    const data = await fetch(`https://www.xeet.ai/api/user/handle/${encodeURIComponent(handle)}/tournaments`);
    return { handle, data };
  }, 'Xeet tournaments');

  for (const { handle, data } of tourneyResults) {
    if (data && data.data) {
      xeetTournaments[handle.toLowerCase()] = data.data;
    }
  }
  console.error(`Got tournaments for ${Object.keys(xeetTournaments).length} creators\n`);

  // Step 5: Merge and compute derived fields
  console.error('Step 5: Merging data and computing derived fields...');
  const output = [];

  for (const creator of allCreators) {
    const handle = creator.xHandle;
    if (!handle) {
      // Creator with no xHandle - include partial row
      output.push({
        xHandle: null,
        displayName: creator.displayName || null,
        walletAddress: creator.walletAddress || null,
        followers: null,
        bio: null,
        ethosScore: null,
        credScore: null,
        totalXeetEarned: null,
        cards: {
          totalIssued: creator.totalCardsIssued || 0,
          totalSupply: 0,
          uniqueCollectors: creator.uniqueCollectors || 0,
          collectorDensity: 0,
          commonSupply: 0,
          rareSupply: 0,
          legendarySupply: 0
        },
        tournaments: [],
        derived: {
          tournamentCount: 0,
          totalXeetsAllTime: 0,
          bestRank: null,
          avgRank: null
        }
      });
      continue;
    }

    const key = handle.toLowerCase();
    const detail = creatorDetails[key] || {};
    const header = xeetHeaders[key] || null;
    const tournaments = xeetTournaments[key] || [];

    // Card stats
    const cards = detail.issuedCards || [];
    let commonSupply = 0, rareSupply = 0, legendarySupply = 0;
    for (const card of cards) {
      const supply = card.totalSupply || 0;
      switch ((card.rarity || '').toLowerCase()) {
        case 'common': commonSupply += supply; break;
        case 'rare': rareSupply += supply; break;
        case 'legendary': legendarySupply += supply; break;
      }
    }
    const totalSupply = detail.totalCardsSupply || (commonSupply + rareSupply + legendarySupply);
    const uniqueCollectors = detail.uniqueCollectors || 0;
    const collectorDensity = totalSupply > 0 ? parseFloat((uniqueCollectors / totalSupply).toFixed(4)) : 0;

    // Tournament derived
    const tournamentCount = tournaments.length;
    const totalXeetsAllTime = tournaments.reduce((sum, t) => sum + (t.totalPoints || 0), 0);
    const ranks = tournaments.map(t => t.rank).filter(r => r != null);
    const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;
    const avgRank = ranks.length > 0 ? parseFloat((ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(1)) : null;

    // Tournament entries (cleaned)
    const tournamentEntries = tournaments.map(t => ({
      tournamentTitle: t.tournamentTitle,
      leagueTitle: t.leagueTitle,
      topicSlug: t.topicSlug || null,
      rank: t.rank,
      rankSignal: t.rankSignal,
      rankNoise: t.rankNoise,
      totalPoints: t.totalPoints,
      signalPoints: t.signalPoints,
      noisePoints: t.noisePoints,
      bonusPoints: t.bonusPoints,
      multiplier: t.multiplier,
      rewardStartDate: t.rewardStartDate,
      rewardEndDate: t.rewardEndDate
    }));

    output.push({
      xHandle: handle,
      displayName: detail.displayName || creator.displayName || null,
      walletAddress: detail.walletAddress || creator.walletAddress || null,
      followers: detail.followers || (header ? header.followerCount : null),
      bio: detail.bio || null,
      ethosScore: header ? header.ethosScore : null,
      credScore: header ? header.credScore : null,
      totalXeetEarned: header ? header.xeetEarned : null,
      cards: {
        totalIssued: detail.totalCardsIssued || creator.totalCardsIssued || 0,
        totalSupply,
        uniqueCollectors,
        collectorDensity,
        commonSupply,
        rareSupply,
        legendarySupply
      },
      tournaments: tournamentEntries,
      derived: {
        tournamentCount,
        totalXeetsAllTime: parseFloat(totalXeetsAllTime.toFixed(2)),
        bestRank,
        avgRank
      }
    });
  }

  // Validation
  console.error('\n=== Validation ===');
  console.error(`Total creators: ${output.length}`);
  const withFollowers = output.filter(c => c.followers != null && c.followers > 0).length;
  console.error(`With followers: ${withFollowers}`);
  const withTournaments = output.filter(c => c.tournaments.length > 0).length;
  console.error(`With tournaments: ${withTournaments}`);

  const ely = output.find(c => c.xHandle && c.xHandle.toLowerCase() === 'proofofely');
  if (ely) {
    console.error(`ProofOfEly: bestRank=${ely.derived.bestRank}, totalXeetEarned=${ely.totalXeetEarned}, totalXeetsAllTime=${ely.derived.totalXeetsAllTime}`);
  }

  const bearish = output.find(c => c.xHandle && c.xHandle.toLowerCase() === 'bearish_af');
  if (bearish) {
    console.error(`bearish_af: followers=${bearish.followers}, totalIssued=${bearish.cards.totalIssued}`);
  }

  // Output
  const jsonOutput = JSON.stringify(output, null, 2);
  fs.writeFileSync('xeet-creators-full.json', jsonOutput);
  console.error(`\nSaved to xeet-creators-full.json (${(Buffer.byteLength(jsonOutput) / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
