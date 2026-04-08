const https = require('https');
const fs = require('fs');

// === CONFIG ===
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const DELAY_MS = 400; // between API requests

const ALL_SLUGS = [
  'xeet-infofi', 'crypto-creator', 'iopn', 'abstract', 'solstice', 'myriad',
  'xeetsgiving', 'adi', 'claynosaurz', 'xyber', 'artery', 'fight', 'vdex',
  'lute', 'kona', 'thrust', 'desci-news', 'valannia', 'mezo', 'gvc', 'blinko',
  'chimpers', 'wow', 'megaweapon', 'santa-browser', 'litvm', 'datahaven',
  'onsight', 'project-zero', 'cockio', 'grimmy', 'cryptoys', 'vault777', 'gamblr', 'cipher'
];

const SKIP_LEADERBOARD = ['crypto-creator', 'xeet-infofi', 'abstract'];

// Some topic slugs differ from tournament/leaderboard slugs
const LEADERBOARD_SLUG_MAP = {
  'cockio': 'cock',
  'thrust': 'thurst',
};

const SMALL_BATCH = ['grimmy', 'cockio', 'cipher', 'gamblr', 'cryptoys', 'vault777', 'project-zero', 'onsight', 'datahaven', 'litvm'];
const MEDIUM_BATCH = ['blinko', 'chimpers', 'wow', 'megaweapon', 'gvc', 'mezo', 'desci-news', 'valannia', 'santa-browser', 'thrust', 'kona', 'lute', 'vdex', 'fight', 'artery'];
const LARGE_BATCH = ['xyber', 'adi', 'claynosaurz', 'xeetsgiving', 'myriad', 'solstice', 'iopn'];

// === FETCH UTILITY ===
function fetchJSON(url, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, retries).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) {
          if (retries > 0) {
            return setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 2000);
          }
          return resolve(null);
        }
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => {
      if (retries > 0) setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 2000);
      else resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      if (retries > 0) setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 2000);
      else resolve(null);
    });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// === STAGE 1: Fetch /api/topics/{slug} ===
async function stage1() {
  console.log('\n=== STAGE 1: Fetch tournament metadata via /api/topics/{slug} ===\n');
  const results = {};
  const errors = [];
  let count = 0;

  for (const slug of ALL_SLUGS) {
    count++;
    console.log(`[${count}/${ALL_SLUGS.length}] Fetching /api/topics/${slug}...`);
    const data = await fetchJSON(`https://xeet.ai/api/topics/${slug}`);
    if (data === null) {
      console.log(`  ERROR: null response for ${slug}`);
      errors.push(slug);
    } else {
      results[slug] = data;
      if (count <= 3) {
        console.log(`  SAMPLE RESPONSE (${slug}):`);
        console.log(JSON.stringify(data, null, 2).split('\n').slice(0, 30).join('\n'));
        console.log('  ...');
      } else {
        console.log(`  OK`);
      }
    }
    await delay(DELAY_MS);
  }

  fs.writeFileSync('tournament-topics-raw.json', JSON.stringify(results, null, 2));
  console.log(`\nSaved tournament-topics-raw.json`);

  // Report
  const fieldSample = Object.values(results)[0];
  const fields = fieldSample ? Object.keys(fieldSample) : [];
  console.log('\n--- STAGE 1 REPORT ---');
  console.log(`Tournaments fetched: ${Object.keys(results).length} / ${ALL_SLUGS.length}`);
  console.log(`Fields available: ${fields.join(', ')}`);
  console.log(`Errors (404/null): ${errors.length > 0 ? errors.join(', ') : 'none'}`);
  console.log('--- END STAGE 1 ---\n');
}

// === STAGE 2: Paginate leaderboards ===
async function stage2(batch = 'small') {
  let slugs;
  if (batch === 'small') slugs = SMALL_BATCH;
  else if (batch === 'medium') slugs = MEDIUM_BATCH;
  else if (batch === 'large') slugs = LARGE_BATCH;
  else if (batch === 'all') slugs = [...SMALL_BATCH, ...MEDIUM_BATCH, ...LARGE_BATCH];
  else { console.log('Unknown batch:', batch); return; }

  console.log(`\n=== STAGE 2: Paginate leaderboards (${batch} batch: ${slugs.length} tournaments) ===\n`);

  // Load existing results if any
  let allResults = {};
  if (fs.existsSync('tournament-leaderboard-counts.json')) {
    allResults = JSON.parse(fs.readFileSync('tournament-leaderboard-counts.json', 'utf8'));
  }

  for (const slug of slugs) {
    if (allResults[slug] && !allResults[slug].skipped) {
      console.log(`[SKIP] ${slug} — already have data (${allResults[slug].totalParticipants} participants)`);
      continue;
    }

    const lbSlug = LEADERBOARD_SLUG_MAP[slug] || slug;
    console.log(`\n--- ${slug} (leaderboard slug: ${lbSlug}) ---`);
    let page = 1;
    let totalParticipants = 0;
    let withScore = 0;
    let emptyStreak = 0;
    let metaTotal = null;
    let totalRequests = 0;

    while (true) {
      const url = `https://xeet.ai/api/tournaments/${lbSlug}/leaderboard?limit=200&page=${page}`;
      if (page % 10 === 1) console.log(`  Page ${page}...`);
      const data = await fetchJSON(url);
      totalRequests++;

      if (!data || !data.data || data.data.length === 0) {
        emptyStreak++;
        if (emptyStreak >= 3) {
          console.log(`  Stopped at page ${page} (3 consecutive empty pages)`);
          break;
        }
        page++;
        await delay(300);
        continue;
      }

      emptyStreak = 0;
      if (page === 1 && data.meta) {
        metaTotal = data.meta.total;
        console.log(`  meta.total = ${metaTotal}`);
      }

      totalParticipants += data.data.length;
      for (const entry of data.data) {
        if (entry.score && entry.score > 0) withScore++;
      }

      // If we got fewer than 200, we're on the last page
      if (data.data.length < 200) {
        console.log(`  Last page ${page} (${data.data.length} entries)`);
        break;
      }

      page++;
      await delay(300);
    }

    allResults[slug] = {
      totalParticipants,
      participantsWithScore: withScore,
      metaTotal,
      pagesScanned: page,
      totalRequests,
      skipped: false
    };

    console.log(`  Result: ${totalParticipants} participants (${withScore} with score>0), meta.total=${metaTotal}`);

    // Save after each tournament
    fs.writeFileSync('tournament-leaderboard-counts.json', JSON.stringify(allResults, null, 2));
  }

  // Add skipped tournaments
  for (const slug of SKIP_LEADERBOARD) {
    if (!allResults[slug]) {
      allResults[slug] = {
        totalParticipants: null,
        participantsWithScore: null,
        metaTotal: null,
        skipped: true,
        skipReason: 'General platform tournament, no brand rewards, too large to paginate'
      };
    }
  }
  fs.writeFileSync('tournament-leaderboard-counts.json', JSON.stringify(allResults, null, 2));

  // Report
  console.log(`\n--- STAGE 2 REPORT (${batch} batch) ---`);
  for (const slug of slugs) {
    const r = allResults[slug];
    if (r && !r.skipped) {
      console.log(`  ${slug}: total=${r.totalParticipants}, withScore=${r.participantsWithScore}, meta.total=${r.metaTotal}`);
    }
  }
  console.log('--- END STAGE 2 ---\n');
}

// === STAGE 3: Compute difficulty metrics ===
async function stage3() {
  console.log('\n=== STAGE 3: Compute tournament difficulty metrics ===\n');

  const creators = JSON.parse(fs.readFileSync('xeet-creators-full.json', 'utf8'));
  const leaderboardCounts = JSON.parse(fs.readFileSync('tournament-leaderboard-counts.json', 'utf8'));

  let topicsRaw = {};
  if (fs.existsSync('tournament-topics-raw.json')) {
    topicsRaw = JSON.parse(fs.readFileSync('tournament-topics-raw.json', 'utf8'));
  }

  // Build per-tournament XCC data
  const tournamentXCCData = {};
  for (const creator of creators) {
    for (const t of creator.tournaments) {
      const slug = t.topicSlug;
      if (!tournamentXCCData[slug]) {
        tournamentXCCData[slug] = {
          slug,
          title: t.tournamentTitle,
          league: t.leagueTitle,
          startDate: t.rewardStartDate,
          endDate: t.rewardEndDate,
          xccEntries: []
        };
      }
      tournamentXCCData[slug].xccEntries.push({
        handle: creator.xHandle,
        rank: t.rank,
        totalPoints: t.totalPoints,
        signalPoints: t.signalPoints,
        noisePoints: t.noisePoints,
        bonusPoints: t.bonusPoints,
        multiplier: t.multiplier
      });
    }
  }

  const metrics = [];

  for (const slug of ALL_SLUGS) {
    const xccData = tournamentXCCData[slug];
    const lb = leaderboardCounts[slug];
    const topic = topicsRaw[slug];

    if (!xccData) {
      console.log(`  ${slug}: no XCC data found, skipping metrics`);
      continue;
    }

    const entries = xccData.xccEntries;
    const points = entries.map(e => e.totalPoints).sort((a, b) => a - b);
    const multipliers = {};
    let bonusRatioSum = 0;
    let bonusRatioCount = 0;

    for (const e of entries) {
      const m = String(e.multiplier);
      multipliers[m] = (multipliers[m] || 0) + 1;
      if (e.totalPoints > 0) {
        bonusRatioSum += e.bonusPoints / e.totalPoints;
        bonusRatioCount++;
      }
    }

    const totalXeetsToXCCs = points.reduce((s, v) => s + v, 0);
    const avgXeetsPerXCC = points.length > 0 ? totalXeetsToXCCs / points.length : 0;
    const medianXeetsPerXCC = points.length > 0 ? points[Math.floor(points.length / 2)] : 0;
    const topEntry = entries.reduce((best, e) => e.totalPoints > best.totalPoints ? e : best, entries[0]);

    const startDate = xccData.startDate ? xccData.startDate.split('T')[0] : null;
    const endDate = xccData.endDate ? xccData.endDate.split('T')[0] : null;
    const durationDays = startDate && endDate
      ? Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24))
      : null;

    const totalParticipants = lb ? lb.totalParticipants : null;
    const participantsWithScore = lb ? lb.participantsWithScore : null;
    const skipped = lb ? (lb.skipped || false) : true;

    const competitionDensity = totalParticipants && entries.length > 0
      ? Math.round((totalParticipants / entries.length) * 10) / 10
      : null;

    const m = {
      slug,
      title: xccData.title,
      league: xccData.league,
      startDate,
      endDate,
      durationDays,
      totalParticipants,
      participantsWithScore,
      skipped,
      skipReason: lb && lb.skipReason ? lb.skipReason : undefined,
      xccParticipants: entries.length,
      xccParticipationRate: Math.round((entries.length / 391) * 1000) / 1000,
      totalXeetsToXCCs: Math.round(totalXeetsToXCCs * 100) / 100,
      avgXeetsPerXCC: Math.round(avgXeetsPerXCC * 100) / 100,
      medianXeetsPerXCC: Math.round(medianXeetsPerXCC * 100) / 100,
      topXeetsInTournament: Math.round(topEntry.totalPoints * 100) / 100,
      topXCCHandle: topEntry.handle,
      multiplierDistribution: multipliers,
      avgBonusRatio: bonusRatioCount > 0 ? Math.round((bonusRatioSum / bonusRatioCount) * 1000) / 1000 : 0,
      competitionDensity,
      description: topic && topic.description ? topic.description : null
    };

    // Remove undefined fields
    Object.keys(m).forEach(k => m[k] === undefined && delete m[k]);
    metrics.push(m);
    console.log(`  ${slug}: ${entries.length} XCCs, ${totalParticipants || '?'} total participants, ${Math.round(totalXeetsToXCCs)} XEETS to XCCs`);
  }

  fs.writeFileSync('tournament-metrics.json', JSON.stringify(metrics, null, 2));
  console.log(`\nSaved tournament-metrics.json (${metrics.length} tournaments)`);

  // Report
  const ranked = metrics.filter(m => m.totalParticipants).sort((a, b) => b.totalParticipants - a.totalParticipants);
  console.log('\n--- STAGE 3 REPORT ---');
  console.log('\nTournament difficulty ranking (by participant count):');
  ranked.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.slug} — ${m.totalParticipants} participants, ${m.xccParticipants} XCCs, density ${m.competitionDensity}`);
  });

  const topXeets = [...metrics].sort((a, b) => b.totalXeetsToXCCs - a.totalXeetsToXCCs).slice(0, 5);
  console.log('\nTop 5 by XEETS distributed to XCCs:');
  topXeets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.slug}: ${m.totalXeetsToXCCs} XEETS`);
  });

  // Global multiplier stats
  const globalMult = {};
  let totalEntries = 0;
  for (const m of metrics) {
    for (const [k, v] of Object.entries(m.multiplierDistribution)) {
      globalMult[k] = (globalMult[k] || 0) + v;
      totalEntries += v;
    }
  }
  console.log('\nMultiplier usage across all tournaments:');
  for (const [k, v] of Object.entries(globalMult).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}x: ${v} entries (${Math.round(v / totalEntries * 100)}%)`);
  }
  console.log('--- END STAGE 3 ---\n');
}

// === STAGE 4: Enrich creator data ===
async function stage4() {
  console.log('\n=== STAGE 4: Enrich creator data with percentile performance ===\n');

  const creators = JSON.parse(fs.readFileSync('xeet-creators-full.json', 'utf8'));
  const metrics = JSON.parse(fs.readFileSync('tournament-metrics.json', 'utf8'));
  const metricsMap = {};
  for (const m of metrics) metricsMap[m.slug] = m;

  // Build XCC rank lists per tournament for xccPercentile
  const xccRanksPerTournament = {};
  for (const creator of creators) {
    for (const t of creator.tournaments) {
      if (!xccRanksPerTournament[t.topicSlug]) xccRanksPerTournament[t.topicSlug] = [];
      xccRanksPerTournament[t.topicSlug].push({ handle: creator.xHandle, rank: t.rank });
    }
  }
  // Sort each tournament's XCC list by rank
  for (const slug in xccRanksPerTournament) {
    xccRanksPerTournament[slug].sort((a, b) => a.rank - b.rank);
  }

  let enrichedCount = 0;
  for (const creator of creators) {
    for (const t of creator.tournaments) {
      const m = metricsMap[t.topicSlug];
      if (!m) continue;

      // Percentile vs all participants (lower = better, 0 = rank 1)
      t.percentile = m.totalParticipants
        ? Math.round((t.rank / m.totalParticipants) * 10000) / 10000
        : null;

      // XCC percentile
      const xccList = xccRanksPerTournament[t.topicSlug];
      const xccRankIndex = xccList.findIndex(e => e.handle === creator.xHandle);
      t.xccPercentile = xccRankIndex >= 0
        ? Math.round(((xccRankIndex + 1) / xccList.length) * 10000) / 10000
        : null;

      t.tournamentSize = m.totalParticipants;
      t.durationDays = m.durationDays;
      enrichedCount++;
    }
  }

  fs.writeFileSync('xeet-creators-enriched.json', JSON.stringify(creators, null, 2));
  console.log(`Enriched ${enrichedCount} tournament entries across ${creators.length} creators`);
  console.log('Saved xeet-creators-enriched.json');

  // Sample
  const sample = creators.find(c => c.xHandle === 'ProofOfEly');
  if (sample && sample.tournaments.length > 0) {
    const t = sample.tournaments.find(t => t.topicSlug === 'grimmy') || sample.tournaments[0];
    console.log(`\nSample — ${sample.xHandle} in ${t.topicSlug}:`);
    console.log(`  rank: ${t.rank}, percentile: ${t.percentile}, xccPercentile: ${t.xccPercentile}, tournamentSize: ${t.tournamentSize}, durationDays: ${t.durationDays}`);
  }
  console.log('\n--- END STAGE 4 ---\n');
}

// === STAGE 5: Output final tournament-metadata.json ===
async function stage5() {
  console.log('\n=== STAGE 5: Output tournament-metadata.json ===\n');

  const metrics = JSON.parse(fs.readFileSync('tournament-metrics.json', 'utf8'));

  // Sort by startDate ascending
  metrics.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return new Date(a.startDate) - new Date(b.startDate);
  });

  const output = {
    generated: new Date().toISOString(),
    totalTournaments: metrics.length,
    tournaments: metrics
  };

  fs.writeFileSync('tournament-metadata.json', JSON.stringify(output, null, 2));
  console.log(`Saved tournament-metadata.json`);
  console.log(`Tournaments: ${metrics.length}`);
  const withData = metrics.filter(m => !m.skipped && m.totalParticipants !== null).length;
  const skipped = metrics.filter(m => m.skipped).length;
  console.log(`With full participant data: ${withData}`);
  console.log(`Skipped (too large): ${skipped}`);
  console.log(`Without leaderboard data: ${metrics.length - withData - skipped}`);
  console.log('\n--- END STAGE 5 ---\n');
}

// === MAIN ===
async function main() {
  const stage = process.argv[2];
  const arg = process.argv[3];

  if (!stage) {
    console.log('Usage: node build-tournament-data.js <stage> [arg]');
    console.log('  stage 1          — Fetch /api/topics metadata');
    console.log('  stage 2 small    — Paginate small tournament leaderboards');
    console.log('  stage 2 medium   — Paginate medium tournament leaderboards');
    console.log('  stage 2 large    — Paginate large tournament leaderboards');
    console.log('  stage 2 all      — Paginate all (non-skipped) leaderboards');
    console.log('  stage 3          — Compute difficulty metrics');
    console.log('  stage 4          — Enrich creator data');
    console.log('  stage 5          — Output tournament-metadata.json');
    return;
  }

  if (stage === '1') await stage1();
  else if (stage === '2') await stage2(arg || 'small');
  else if (stage === '3') await stage3();
  else if (stage === '4') await stage4();
  else if (stage === '5') await stage5();
  else console.log('Unknown stage:', stage);
}

main().catch(console.error);
