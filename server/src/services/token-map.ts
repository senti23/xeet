import { readFileSync } from 'fs';
import { config } from '../config.js';
import { getDb, getStmts } from '../db/index.js';
import { getAllNFTs, type OpenSeaNFT } from './opensea-client.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('token-map');

export type Rarity = 'common' | 'rare' | 'legendary';

export interface CreatorInfo {
  handle: string;
  displayName: string;
  walletAddress: string;
  rarities: Rarity[];
  commonSupply: number;
  rareSupply: number;
  legendarySupply: number;
}

interface TokenMapping {
  tokenId: string;
  creatorHandle: string;
  rarity: Rarity;
  name: string | null;
  imageUrl: string | null;
}

// In-memory maps
const tokenToCreator = new Map<string, { handle: string; rarity: Rarity }>();
const creatorToTokens = new Map<string, string[]>(); // key: "handle:rarity"
const creators = new Map<string, CreatorInfo>();
let initialized = false;
let backgroundSyncRunning = false;

export function getCreatorRarity(tokenId: string): { handle: string; rarity: Rarity } | null {
  return tokenToCreator.get(tokenId) ?? null;
}

export function getTokenIds(handle: string, rarity: Rarity): string[] {
  return creatorToTokens.get(`${handle}:${rarity}`) ?? [];
}

export function getAllCreators(): Map<string, CreatorInfo> {
  return creators;
}

export function getCreator(handle: string): CreatorInfo | undefined {
  return creators.get(handle.toLowerCase());
}

export function isValidCreator(handle: string): boolean {
  return creators.has(handle.toLowerCase());
}

export function isInitialized(): boolean {
  return initialized;
}

export function getTokenMapStats(): {
  totalMappedTokens: number;
  totalCreators: number;
  sampleMappings: Array<{ tokenId: string; handle: string; rarity: string }>;
} {
  const sample: Array<{ tokenId: string; handle: string; rarity: string }> = [];
  let count = 0;
  for (const [tokenId, mapping] of tokenToCreator) {
    if (count++ >= 10) break;
    sample.push({ tokenId, handle: mapping.handle, rarity: mapping.rarity });
  }
  return {
    totalMappedTokens: tokenToCreator.size,
    totalCreators: creators.size,
    sampleMappings: sample,
  };
}

function addTokenMapping(m: TokenMapping) {
  tokenToCreator.set(m.tokenId, { handle: m.creatorHandle, rarity: m.rarity });
  const key = `${m.creatorHandle}:${m.rarity}`;
  const existing = creatorToTokens.get(key) ?? [];
  if (!existing.includes(m.tokenId)) {
    existing.push(m.tokenId);
    creatorToTokens.set(key, existing);
  }
}

/** Step 1: Load creators from xeet-creators-full.json */
function loadCreatorSeed(): void {
  try {
    const raw = readFileSync(config.creatorsJsonPath, 'utf-8');
    const data: Array<{
      xHandle: string;
      displayName: string;
      walletAddress: string;
      cards?: { commonSupply: number; rareSupply: number; legendarySupply: number };
    }> = JSON.parse(raw);

    for (const c of data) {
      const handle = c.xHandle.toLowerCase();
      const rarities: Rarity[] = [];
      const cs = c.cards?.commonSupply ?? 0;
      const rs = c.cards?.rareSupply ?? 0;
      const ls = c.cards?.legendarySupply ?? 0;
      if (cs > 0) rarities.push('common');
      if (rs > 0) rarities.push('rare');
      if (ls > 0) rarities.push('legendary');

      creators.set(handle, {
        handle: c.xHandle,
        displayName: c.displayName || c.xHandle,
        walletAddress: c.walletAddress,
        rarities,
        commonSupply: cs,
        rareSupply: rs,
        legendarySupply: ls,
      });
    }
    log.info({ count: creators.size }, 'Creator seed loaded from JSON');
  } catch (err) {
    log.error({ err }, 'Failed to load creator seed JSON');
  }
}

/** Step 2: Load existing token map from SQLite */
function loadFromDb(): number {
  const stmts = getStmts();
  const rows = stmts.getAllTokens.all() as Array<{
    token_id: string;
    creator_handle: string;
    rarity: string;
    name: string | null;
    image_url: string | null;
  }>;

  for (const row of rows) {
    addTokenMapping({
      tokenId: row.token_id,
      creatorHandle: row.creator_handle,
      rarity: row.rarity as Rarity,
      name: row.name,
      imageUrl: row.image_url,
    });
  }

  log.info({ count: rows.length }, 'Token map loaded from SQLite');
  return rows.length;
}

/** Step 3: Background fetch from OpenSea NFTs */
async function syncFromOpenSea(): Promise<void> {
  if (backgroundSyncRunning) return;
  backgroundSyncRunning = true;

  try {
    log.info('Starting OpenSea NFT sync for token map');
    const nfts = await getAllNFTs();
    const stmts = getStmts();

    // Debug: log sample NFT structure to diagnose trait issues
    if (nfts.length > 0) {
      const sample = nfts[0];
      log.info({
        sampleId: sample.identifier,
        sampleName: sample.name,
        hasTraits: !!sample.traits,
        traitCount: sample.traits?.length ?? 0,
        traitTypes: sample.traits?.map((t) => t.trait_type) ?? [],
        sampleTraits: sample.traits?.slice(0, 5) ?? [],
      }, 'NFT sync sample - first NFT structure');
    } else {
      log.warn('NFT sync returned 0 NFTs');
    }

    let withTraits = 0;
    let withoutTraits = 0;
    let mapped = 0;

    const db = getDb();
    const upsertMany = db.transaction((items: OpenSeaNFT[]) => {
      for (const nft of items) {
        const creatorTrait = nft.traits?.find(
          (t) => t.trait_type.toLowerCase() === 'creator' || t.trait_type.toLowerCase() === 'creator handle',
        );
        const rarityTrait = nft.traits?.find((t) => t.trait_type.toLowerCase() === 'rarity');

        if (!creatorTrait || !rarityTrait) {
          withoutTraits++;
          continue;
        }
        withTraits++;

        const handle = String(creatorTrait.value).toLowerCase();
        const rarity = String(rarityTrait.value).toLowerCase() as Rarity;
        if (!['common', 'rare', 'legendary'].includes(rarity)) continue;

        stmts.upsertToken.run(nft.identifier, handle, rarity, nft.name, nft.image_url);
        addTokenMapping({
          tokenId: nft.identifier,
          creatorHandle: handle,
          rarity,
          name: nft.name,
          imageUrl: nft.image_url,
        });
        mapped++;
      }
    });

    upsertMany(nfts);
    log.info({
      totalNFTs: nfts.length,
      withTraits,
      withoutTraits,
      mapped,
      mappedTokens: tokenToCreator.size,
    }, 'OpenSea NFT sync complete');
  } catch (err) {
    log.error({ err }, 'OpenSea NFT sync failed');
  } finally {
    backgroundSyncRunning = false;
  }
}

/** Initialize: load seed + DB, then kick off background OpenSea sync */
export async function initTokenMap(): Promise<void> {
  // Step 1: Load creator seed (immediate)
  loadCreatorSeed();

  // Step 2: Load from SQLite (immediate)
  const dbCount = loadFromDb();

  initialized = true;

  // Step 3: Sync from OpenSea (awaited so token map is ready before pipeline starts)
  try {
    await syncFromOpenSea();
  } catch (err) {
    log.error({ err }, 'OpenSea sync error (will rely on SQLite cache)');
  }

  log.info(
    { creators: creators.size, mappedTokens: tokenToCreator.size },
    'Token map initialized',
  );
}
