import type { HistoricalResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchHistoricalData(days: number = 100): Promise<HistoricalResponse> {
  const response = await fetch(`${API_URL}/api/historical?days=${days}`);
  if (!response.ok) {
    throw new Error('Failed to fetch data');
  }
  return response.json();
}
