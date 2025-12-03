import type { HistoricalResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Cache configuration
const CACHE_KEY_PREFIX = 'historical_data_cache_';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CachedData {
  data: HistoricalResponse;
  timestamp: number;
}

function getCacheKey(days: number): string {
  return `${CACHE_KEY_PREFIX}${days}`;
}

function getCachedData(days: number): HistoricalResponse | null {
  try {
    const cached = window.localStorage.getItem(getCacheKey(days));
    if (!cached) return null;

    const cachedData: CachedData = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is still valid
    if (now - cachedData.timestamp < CACHE_TTL) {
      // Also validate the cache has actual data
      const machines = cachedData.data?.machines || {};
      const totalRuns = Object.values(machines).reduce((sum, runs) => sum + runs.length, 0);
      if (totalRuns === 0) {
        // Empty cache, remove it
        window.localStorage.removeItem(getCacheKey(days));
        return null;
      }
      return cachedData.data;
    }

    // Cache is stale, remove it
    window.localStorage.removeItem(getCacheKey(days));
    return null;
  } catch {
    // If there's any error parsing cache, just ignore it
    window.localStorage.removeItem(getCacheKey(days));
    return null;
  }
}

function setCachedData(days: number, data: HistoricalResponse): void {
  try {
    const cacheData: CachedData = {
      data,
      timestamp: Date.now(),
    };
    window.localStorage.setItem(getCacheKey(days), JSON.stringify(cacheData));
  } catch {
    // If localStorage is full or unavailable, just continue without caching
    console.warn('Failed to cache data');
  }
}

export async function fetchHistoricalData(days: number = 100, forceRefresh = false): Promise<HistoricalResponse> {
  // Try to get from cache first (unless force refresh is requested)
  if (!forceRefresh) {
    const cachedData = getCachedData(days);
    if (cachedData) {
      return cachedData;
    }
  }

  // If not in cache or force refresh, fetch from API
  const response = await fetch(`${API_URL}/api/historical?days=${days}`, {
    cache: 'no-cache', // Always revalidate with server
  });
  if (!response.ok) {
    throw new Error('Failed to fetch data');
  }
  const data = await response.json();

  // Cache the result
  setCachedData(days, data);

  return data;
}

// Helper to clear the cache manually
export function clearHistoricalDataCache(): void {
  // Clear all cache entries
  const keys = Object.keys(window.localStorage);
  for (const key of keys) {
    if (key.startsWith(CACHE_KEY_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}
