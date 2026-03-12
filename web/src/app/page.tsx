import { ListingsTable } from '../components/ListingsTable';
import type { ListingsResponse } from '../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function getListings(): Promise<ListingsResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/listings?limit=500`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  } catch {
    // Return empty data if API is not yet available
    return {
      data: [],
      meta: { total: 0, page: 1, limit: 500, lastUpdated: null, ethUsdRate: 0 },
    };
  }
}

export default async function DashboardPage() {
  const listings = await getListings();

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Live Listings</h2>
        <p className="text-gray-500 text-sm">
          Floor prices, listing counts, and offers across Xeet and OpenSea for all Creator Cards
        </p>
      </div>
      <ListingsTable initialData={listings} />
    </div>
  );
}
