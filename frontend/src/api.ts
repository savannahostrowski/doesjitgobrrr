import type { HistoricalResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Cache configuration
const CACHE_KEY = 'historical_data_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CachedData {
  data: HistoricalResponse;
  timestamp: number;
  days: number;
}

function getCachedData(days: number): HistoricalResponse | null {
  try {
    const cached = window.localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const cachedData: CachedData = JSON.parse(cached);
    const now = Date.now();

    // Check if cache is still valid and matches the requested days
    if (cachedData.days === days && now - cachedData.timestamp < CACHE_TTL) {
      return cachedData.data;
    }

    // Cache is stale or doesn't match request, remove it
    window.localStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    // If there's any error parsing cache, just ignore it
    window.localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function setCachedData(days: number, data: HistoricalResponse): void {
  try {
    const cacheData: CachedData = {
      data,
      timestamp: Date.now(),
      days,
    };
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
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
  const response = await fetch(`${API_URL}/api/historical?days=${days}`);
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
  window.localStorage.removeItem(CACHE_KEY);
}
