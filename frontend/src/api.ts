import type { Resource } from 'solid-js';
import { createResource, createRoot } from 'solid-js';
import type { HistoricalResponse, MachinesMap, PerfEvent } from './types';

export type { Resource };

const DATA_URL = import.meta.env.VITE_DATA_URL ?? '';

interface Manifest {
  dates: string[];
}

const dataPath = (path: string) => `${DATA_URL}/data/${path}`;

async function fetchJson<T>(path: string, errorMessage: string): Promise<T> {
  const response = await fetch(dataPath(path), { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return response.json();
}

// In-memory caches keep route changes fast without hiding freshly deployed
// dashboard data after a browser refresh.
const summaryMemoryCache = new Map<number | 'all', HistoricalResponse>();
const dateMemoryCache = new Map<string, HistoricalResponse>();
let machinesMemoryCache: MachinesMap | null = null;
let availableDatesCache: string[] | null = null;

/**
 * Fetch summary data for the chart (lightweight, no benchmark details).
 */
export async function fetchHistoricalSummary(
  days: number | 'all' = 30,
): Promise<HistoricalResponse> {
  if (summaryMemoryCache.has(days)) {
    return summaryMemoryCache.get(days)!;
  }

  const data = await fetchJson<HistoricalResponse>(
    days === 'all' ? 'summary-all.json' : `summary-${days}.json`,
    'Failed to fetch data',
  );
  summaryMemoryCache.set(days, data);
  return data;
}

/**
 * Fetch full historical data for a specific date (for detail view).
 */
export async function fetchHistoricalByDate(
  date: string,
): Promise<HistoricalResponse> {
  if (dateMemoryCache.has(date)) {
    return dateMemoryCache.get(date)!;
  }

  const data = await fetchJson<HistoricalResponse>(
    `runs/${date}.json`,
    'Failed to fetch data',
  );
  dateMemoryCache.set(date, data);
  return data;
}

/**
 * Fetch machine metadata (colors, arch, descriptions).
 */
export async function fetchMachines(): Promise<MachinesMap> {
  if (machinesMemoryCache) {
    return machinesMemoryCache;
  }

  const json = await fetchJson<{ machines: MachinesMap }>(
    'machines.json',
    'Failed to fetch machines',
  );
  machinesMemoryCache = json.machines;
  return json.machines;
}

// Singleton resource — created once, shared across all components so machine
// names never flash "unknown" when navigating between detail pages.
export const machinesResource: Resource<MachinesMap> = createRoot(
  () => createResource(fetchMachines)[0],
);

export async function fetchPerfEvents(): Promise<PerfEvent[]> {
  const json = await fetchJson<{ events?: PerfEvent[] }>(
    'events.json',
    'Failed to fetch perf events',
  );
  return json.events ?? [];
}

// Singleton resource so the chart and the /changes page share one fetch.
export const perfEventsResource: Resource<PerfEvent[]> = createRoot(
  () => createResource(fetchPerfEvents, { initialValue: [] })[0],
);

/**
 * Fetch the list of all available benchmark run dates (sorted ascending).
 */
export async function fetchAvailableDates(): Promise<string[]> {
  if (availableDatesCache) {
    return availableDatesCache;
  }

  const manifest = await fetchJson<Manifest>(
    'manifest.json',
    'Failed to fetch available dates',
  );
  availableDatesCache = [...manifest.dates].sort();
  return availableDatesCache;
}
