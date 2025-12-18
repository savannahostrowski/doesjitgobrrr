import type { HistoricalResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Cache configuration
const CACHE_KEY_SUMMARY_PREFIX = 'historical_summary_cache_';
const CACHE_KEY_DATE_PREFIX = 'historical_date_cache_';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

interface CachedData {
  data: HistoricalResponse;
  timestamp: number;
}

function getCachedData(cacheKey: string): HistoricalResponse | null {
  try {
    const cached = globalThis.localStorage.getItem(cacheKey);
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
        globalThis.localStorage.removeItem(cacheKey);
        return null;
      }
      return cachedData.data;
    }

    // Cache is stale, remove it
    globalThis.localStorage.removeItem(cacheKey);
    return null;
  } catch {
    // If there's any error parsing cache, just ignore it
    try {
      globalThis.localStorage.removeItem(cacheKey);
    } catch {
      // localStorage may be unavailable
    }
    return null;
  }
}

function setCachedData(cacheKey: string, data: HistoricalResponse): void {
  try {
    const cacheData: CachedData = {
      data,
      timestamp: Date.now(),
    };
    globalThis.localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Fetch summary data for the chart (lightweight, no benchmark details)
 */
export async function fetchHistoricalSummary(days: number = 100, forceRefresh = false): Promise<HistoricalResponse> {
  const cacheKey = `${CACHE_KEY_SUMMARY_PREFIX}${days}`;

  // Try to get from cache first (unless force refresh is requested)
  if (!forceRefresh) {
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      return cachedData;
    }
  }

  // If not in cache or force refresh, fetch from API
  const response = await fetch(`${API_URL}/api/historical/summary?days=${days}`, {
    cache: 'no-cache', // Always revalidate with server
  });
  if (!response.ok) {
    throw new Error('Failed to fetch data');
  }
  const data = await response.json();

  // Cache the result
  setCachedData(cacheKey, data);

  return data;
}

/**
 * Fetch full historical data for a specific date (for detail view)
 */
export async function fetchHistoricalByDate(date: string, forceRefresh = false): Promise<HistoricalResponse> {
  const cacheKey = `${CACHE_KEY_DATE_PREFIX}${date}`;

  // Try to get from cache first (unless force refresh is requested)
  if (!forceRefresh) {
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      return cachedData;
    }
  }

  const response = await fetch(`${API_URL}/api/historical/date/${date}`, {
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch data');
  }
  const data = await response.json();

  // Cache the result
  setCachedData(cacheKey, data);

  return data;
}

// Helper to clear the cache manually
export function clearHistoricalDataCache(): void {
  try {
    const keys = Object.keys(globalThis.localStorage);
    for (const key of keys) {
      if (key.startsWith(CACHE_KEY_SUMMARY_PREFIX) || key.startsWith(CACHE_KEY_DATE_PREFIX)) {
        globalThis.localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage may be unavailable
  }
}
