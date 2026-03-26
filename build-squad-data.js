const fs = require('fs');
const https = require('https');
const path = require('path');

const HANDLES = [
  'ProofOfEly',
  'whemohere', 'dustinvibes', 'youfadedwealth', 'scottybmitch', 'tolibear_', 'chesus', 'katexbt',
  'IcoBeast', 'shivst3r', 'hannahhughes', 'matchayuma', 'greenytrades', 'coperto_xbt'
];

const ROLES = {
  ProofOfEly: 'Educator / Show host',
  whemohere: 'Content creator',
  dustinvibes: 'Educator',
  youfadedwealth: 'Builder / Trader',
  scottybmitch: 'Founder',
  tolibear_: 'Founder / Builder',
  chesus: 'Content / Alpha',
  katexbt: 'Trader / Content',
  IcoBeast: 'Alpha / Research',
  shivst3r: 'Community / Content',
  hannahhughes: 'Growth / Marketing',
  matchayuma: 'Creator / Educator',
  greenytrades: 'Trader / Analyst',
  coperto_xbt: 'Content / Analyst'
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function fetchImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const req = https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchImage(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) {
        console.log(`  ✗ HTTP ${res.statusCode} for ${url}`);
        res.resume();
        return resolve(null);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || 'image/jpeg';
        resolve(`data:${contentType};base64,${buf.toString('base64')}`);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', (e) => {
      console.log(`  ✗ Error: ${e.message} for ${url}`);
      resolve(null);
    });
    req.on('timeout', () => {
      console.log(`  ✗ Timeout for ${url}`);
      req.destroy();
      resolve(null);
    });
  });
}

function extractCreator(creator, handle) {
  const tournaments = creator.tournaments || [];
  let totalPts = 0, signalPts = 0, bonusPts = 0;
  for (const t of tournaments) {
    totalPts += t.totalPoints || 0;
    signalPts += t.signalPoints || 0;
    bonusPts += t.bonusPoints || 0;
  }

  return {
    handle,
    name: creator.displayName,
    avatar: null,
    followers: creator.followers,
    lifetimeXeets: round2(totalPts),
    signalRatio: totalPts > 0 ? round2(signalPts / totalPts) : 0,
    bonusDependency: totalPts > 0 ? round2(bonusPts / totalPts) : 0,
    bestRank: creator.derived?.bestRank ?? null,
    tournamentCount: creator.derived?.tournamentCount ?? 0,
    avgRank: creator.derived?.avgRank != null ? round2(creator.derived.avgRank) : null,
    supply: creator.cards?.totalSupply ?? 0,
    common: creator.cards?.commonSupply ?? 0,
    rare: creator.cards?.rareSupply ?? 0,
    legendary: creator.cards?.legendarySupply ?? 0,
    holders: creator.cards?.uniqueCollectors ?? 0,
    role: ROLES[handle]
  };
}

async function main() {
  const dir = __dirname;
  const creatorsRaw = JSON.parse(fs.readFileSync(path.join(dir, 'xeet-creators-full.json'), 'utf8'));
  const profilesRaw = JSON.parse(fs.readFileSync(path.join(dir, 'creators-profiles.json'), 'utf8'));

  // Case-insensitive lookup maps
  const creatorMap = new Map();
  for (const c of creatorsRaw) {
    creatorMap.set(c.xHandle.toLowerCase(), c);
  }
  const profileMap = new Map();
  for (const [k, v] of Object.entries(profilesRaw)) {
    profileMap.set(k.toLowerCase(), v);
  }

  let found = 0, notFound = 0, avatarsOk = 0, avatarsFail = 0;
  const results = [];

  for (const handle of HANDLES) {
    const creator = creatorMap.get(handle.toLowerCase());
    if (!creator) {
      console.log(`✗ NOT FOUND in data: ${handle}`);
      notFound++;
      results.push({
        handle, name: handle, avatar: null, followers: null,
        lifetimeXeets: null, signalRatio: null, bonusDependency: null,
        bestRank: null, tournamentCount: null, avgRank: null,
        supply: null, common: null, rare: null, legendary: null,
        holders: null, role: ROLES[handle]
      });
      continue;
    }
    found++;
    const entry = extractCreator(creator, handle);

    // Avatar
    const profile = profileMap.get(handle.toLowerCase());
    const avatarUrl = profile?.avatar || null;
    if (avatarUrl) {
      console.log(`  ↓ Downloading avatar for ${handle}...`);
      const b64 = await fetchImage(avatarUrl);
      if (b64) {
        entry.avatar = b64;
        avatarsOk++;
      } else {
        avatarsFail++;
      }
    } else {
      console.log(`  - No avatar URL for ${handle}`);
      avatarsFail++;
    }

    results.push(entry);
  }

  const leader = results[0];
  const members = results.slice(1);

  const output = {
    generated: new Date().toISOString(),
    squad: "Ely's Squad — DeFi Protocol X",
    leader,
    members
  };

  const outPath = path.join(dir, 'squad-visual-data.json');
  const json = JSON.stringify(output, null, 2);
  fs.writeFileSync(outPath, json);

  const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`\n=== Summary ===`);
  console.log(`Creators found: ${found}/14`);
  console.log(`Creators not found: ${notFound}/14`);
  console.log(`Avatars downloaded: ${avatarsOk}/14`);
  console.log(`Avatars failed/missing: ${avatarsFail}/14`);
  console.log(`Output: ${outPath} (${sizeKB} KB)`);
}

main().catch(console.error);
