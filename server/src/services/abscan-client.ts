import { config } from '../config.js';
import { AdaptiveRateLimiter } from '../lib/rate-limiter.js';
import { withRetry } from '../lib/retry.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('abscan-client');
// Abscan free tier ~5 req/sec. Be conservative: start at 2, max 4.
const limiter = new AdaptiveRateLimiter('abscan', 1, 4, 2);

const BASE = config.abscan.baseUrl;
const CONTRACT = config.opensea.contract;

// --- Types ---

export interface ERC1155Transfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  tokenID: string;
  tokenValue: string;
}

interface AbscanResponse<T> {
  status: string;
  message: string;
  result: T;
}

// --- Core fetch ---

async function abscanFetch<T>(params: Record<string, string>, label: string): Promise<T | null> {
  if (!config.abscan.apiKey) {
    log.warn('No ABSCAN_API_KEY set — skipping fetch');
    return null;
  }

  await limiter.acquire();
  return withRetry(
    async () => {
      const searchParams = new URLSearchParams({
        chainid: config.abscan.chainId,
        ...params,
        apikey: config.abscan.apiKey,
      });
      const url = `${BASE}?${searchParams}`;
      log.debug({ url }, `Fetching ${label}`);
      const res = await fetch(url);
      if (!res.ok) {
        limiter.onError(res.status);
        throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
      }
      limiter.onSuccess();
      const data = (await res.json()) as AbscanResponse<T>;
      if (data.status === '0' && data.message === 'No transactions found') {
        return null;
      }
      if (data.status === '0') {
        throw new Error(`${label} API error: ${data.message} — ${JSON.stringify(data.result)}`);
      }
      return data.result;
    },
    { label, maxAttempts: 3, baseDelayMs: 1500 },
  );
}

// --- Public methods ---

/**
 * Fetch all ERC-1155 transfer events for the contract.
 * Paginates automatically. Use startBlock for incremental sync.
 */
export async function getERC1155Transfers(startBlock = 0): Promise<ERC1155Transfer[]> {
  const allTransfers: ERC1155Transfer[] = [];
  const PAGE_SIZE = 10000; // max allowed by API (page * offset <= 10000)
  let currentStartBlock = startBlock;

  for (let batch = 1; ; batch++) {
    const transfers = await abscanFetch<ERC1155Transfer[]>(
      {
        module: 'account',
        action: 'token1155tx',
        contractaddress: CONTRACT,
        startblock: String(currentStartBlock),
        endblock: '99999999',
        page: '1',
        offset: String(PAGE_SIZE),
        sort: 'asc',
      },
      `abscan-1155tx-batch-${batch}`,
    );

    if (!transfers || transfers.length === 0) break;
    allTransfers.push(...transfers);

    // Advance startBlock to last seen block for next batch
    const lastBlock = parseInt(transfers[transfers.length - 1].blockNumber, 10);
    log.info({ batch, fetched: transfers.length, total: allTransfers.length, lastBlock }, 'ERC-1155 transfers fetched');

    if (transfers.length < PAGE_SIZE) break; // got everything

    // Move past last block to avoid duplicates at boundary
    currentStartBlock = lastBlock + 1;
  }

  return allTransfers;
}

/**
 * Quick health check — fetch 1 page of 5 transfers to verify API key works.
 */
export async function healthCheck(): Promise<{ ok: boolean; sampleCount: number; error?: string }> {
  try {
    const transfers = await abscanFetch<ERC1155Transfer[]>(
      {
        module: 'account',
        action: 'token1155tx',
        contractaddress: CONTRACT,
        startblock: '0',
        endblock: '99999999',
        page: '1',
        offset: '5',
        sort: 'asc',
      },
      'abscan-health-check',
    );
    return { ok: true, sampleCount: transfers?.length ?? 0 };
  } catch (err) {
    return { ok: false, sampleCount: 0, error: String(err) };
  }
}
