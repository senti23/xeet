const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface CreatorRarityData {
  creator: string;
  displayName: string;
  rarity: 'common' | 'rare' | 'legendary';
  xeetFloor: number | null;
  xeetListingCount: number;
  osFloor: number | null;
  osListingCount: number;
  bestOffer: number | null;
  lastSaleXeet: number | null;
  lastSaleXeetDate: string | null;
  lastSaleOs: number | null;
  lastSaleOsDate: string | null;
  usdEstimate: number | null;
  osFloorExpiry: string | null;
}

export interface ListingsResponse {
  data: CreatorRarityData[];
  meta: {
    total: number;
    page: number;
    limit: number;
    lastUpdated: string | null;
    ethUsdRate: number;
  };
}

export interface StatsResponse {
  totalCreators: number;
  creatorsWithListings: number;
  totalXeetListings: number;
  totalOsListings: number;
  xeetFloorMin: number | null;
  osFloorMin: number | null;
  ethUsdRate: number;
  lastUpdated: string | null;
}

export async function fetchListings(params?: {
  search?: string;
  rarity?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}): Promise<ListingsResponse> {
  const url = new URL(`${API_BASE}/api/listings`);
  if (params?.search) url.searchParams.set('search', params.search);
  if (params?.rarity) url.searchParams.set('rarity', params.rarity);
  if (params?.sort) url.searchParams.set('sort', params.sort);
  if (params?.order) url.searchParams.set('order', params.order);
  if (params?.page) url.searchParams.set('page', String(params.page));
  if (params?.limit) url.searchParams.set('limit', String(params.limit));

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_BASE}/api/stats`, { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
