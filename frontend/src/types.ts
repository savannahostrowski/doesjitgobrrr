export interface BenchmarkResult {
  mean: number;
  median: number;
  stddev: number;
  min_value: number;
  max_value: number;
}

export interface BenchmarkRun {
  date: string;
  commit: string;
  python_version: string;
  is_jit: boolean;
  geomean: number | null;
  speedup: number | null;  // Speedup ratio for JIT runs (nonjit_time / jit_time)
  benchmarks: Record<string, BenchmarkResult>;
}

export interface HistoricalResponse {
  days: number;
  historical_runs: BenchmarkRun[];
}

export interface ComparisonRow {
  name: string;
  nonjit_mean: number | null;
  jit_mean: number | null;
  diff: number | null;
  speedup: number | null;
}

export type SortColumn = 'name' | 'nonjit_mean' | 'jit_mean' | 'diff' | 'speedup';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}
