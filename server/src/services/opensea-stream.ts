import { OpenSeaStreamClient, Network } from '@opensea/stream-js';
import { WebSocket } from 'ws';
import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import { getCreatorRarity, type Rarity } from './token-map.js';
import { extractEthPrice } from './opensea-client.js';
import * as osClient from './opensea-client.js';

const log = childLogger('opensea-stream');

export interface StreamListing {
  orderHash: string;
  tokenId: string;
  creatorHandle: string;
  rarity: Rarity;
  ethPrice: number;
  maker: string;
  expirationDate: string | null;
  eventTimestamp: string;
  marketplace: 'opensea';
}

type StreamListingCallback = (listing: StreamListing) => void;
let onListingCallback: StreamListingCallback | null = null;

let client: OpenSeaStreamClient | null = null;
let connected = false;
let reconnectAttempts = 0;
let disconnectedSince: number | null = null;
let fallbackInterval: ReturnType<typeof setInterval> | null = null;

export function onNewListing(cb: StreamListingCallback): void {
  onListingCallback = cb;
}

function handleItemListed(event: any): void {
  try {
    const payload = event.payload;
    if (!payload) return;

    const tokenId = payload.item?.nft_id?.split('/')?.pop();
    if (!tokenId) return;

    const mapping = getCreatorRarity(tokenId);
    if (!mapping) {
      log.debug({ tokenId }, 'No mapping for listed token');
      return;
    }

    const ethPrice = payload.base_price
      ? Number(BigInt(payload.base_price)) / 1e18
      : payload.payment_token?.eth_price
        ? Number(payload.payment_token.eth_price)
        : 0;

    const listing: StreamListing = {
      orderHash: payload.order_hash || `stream-${Date.now()}`,
      tokenId,
      creatorHandle: mapping.handle,
      rarity: mapping.rarity,
      ethPrice,
      maker: payload.maker?.address || '',
      expirationDate: payload.expiration_date || null,
      eventTimestamp: payload.event_timestamp || new Date().toISOString(),
      marketplace: 'opensea',
    };

    log.info(
      { creator: listing.creatorHandle, rarity: listing.rarity, eth: listing.ethPrice },
      'New OpenSea listing detected',
    );

    if (onListingCallback) {
      onListingCallback(listing);
    }
  } catch (err) {
    log.error({ err, event: JSON.stringify(event).slice(0, 500) }, 'Error processing stream event');
  }
}

function startFallbackPolling(): void {
  if (fallbackInterval) return;
  log.warn('Starting fallback REST polling (WebSocket disconnected)');

  let lastSeenHashes = new Set<string>();

  fallbackInterval = setInterval(async () => {
    try {
      const listings = await osClient.getAllListings(); // Just recent pages
      const currentHashes = new Set<string>();

      for (const order of listings) {
        currentHashes.add(order.order_hash);
        if (lastSeenHashes.size > 0 && !lastSeenHashes.has(order.order_hash)) {
          // New listing detected via polling
          const tokenId = osClient.extractTokenId(order);
          if (!tokenId) continue;
          const mapping = getCreatorRarity(tokenId);
          if (!mapping) continue;

          const listing: StreamListing = {
            orderHash: order.order_hash,
            tokenId,
            creatorHandle: mapping.handle,
            rarity: mapping.rarity,
            ethPrice: osClient.extractEthPrice(order),
            maker: order.protocol_data?.parameters?.offerer || '',
            expirationDate: osClient.extractOrderExpiry(order)?.toISOString() || null,
            eventTimestamp: new Date().toISOString(),
            marketplace: 'opensea',
          };

          if (onListingCallback) onListingCallback(listing);
        }
      }

      lastSeenHashes = currentHashes;
    } catch (err) {
      log.error({ err }, 'Fallback polling error');
    }
  }, 60_000);
}

function stopFallbackPolling(): void {
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
    log.info('Fallback polling stopped (WebSocket reconnected)');
  }
}

export async function startStream(): Promise<void> {
  if (!config.opensea.apiKey) {
    log.warn('No OpenSea API key — stream disabled');
    return;
  }

  try {
    client = new OpenSeaStreamClient({
      network: Network.MAINNET,
      token: config.opensea.apiKey,
      connectOptions: {
        transport: WebSocket as any,
      },
      onError: (error: unknown) => {
        log.error({ err: error }, 'OpenSea stream error');
      },
    });

    client.onItemListed(config.opensea.collectionSlug, (event) => {
      connected = true;
      disconnectedSince = null;
      reconnectAttempts = 0;
      stopFallbackPolling();
      handleItemListed(event);
    });

    // Also track sales for pipeline updates
    client.onItemSold(config.opensea.collectionSlug, (event) => {
      log.info({ event: JSON.stringify(event).slice(0, 300) }, 'Item sold event');
    });

    connected = true;
    log.info('OpenSea stream connected');
  } catch (err) {
    log.error({ err }, 'Failed to start OpenSea stream');
    connected = false;
    disconnectedSince = Date.now();
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60_000);
  reconnectAttempts++;
  log.info({ delay, attempt: reconnectAttempts }, 'Scheduling stream reconnect');

  setTimeout(async () => {
    try {
      await startStream();
    } catch {
      scheduleReconnect();
    }
  }, delay);

  // Start fallback polling if disconnected > 90s
  if (disconnectedSince && Date.now() - disconnectedSince > 90_000) {
    startFallbackPolling();
  }
}

export function stopStream(): void {
  if (client) {
    client.disconnect();
    client = null;
  }
  stopFallbackPolling();
  connected = false;
  log.info('OpenSea stream stopped');
}

export function isStreamConnected(): boolean {
  return connected;
}
