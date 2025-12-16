export interface BenchmarkResult {
  mean: number;
  median: number;
  stddev: number;
  min_value: number;
  max_value: number;
}

export interface HPTData {
  reliability: number | null;
  percentile_90: number | null;
  percentile_95: number | null;
  percentile_99: number | null;
}

export interface BenchmarkRun {
  date: string;
  commit: string;
  python_version: string;
  is_jit: boolean;
  machine: string;
  directory_name: string;
  has_tailcall: boolean;
  created_at: string;
  geomean: number | null;
  speedup: number | null;  // Speedup ratio for JIT runs (nonjit_time / jit_time)
  hpt?: HPTData;  // HPT statistical comparison data (only for JIT runs)
  benchmarks: Record<string, BenchmarkResult>;
}

export interface HistoricalResponse {
  days: number;
  machines: Record<string, BenchmarkRun[]>;  // Grouped by machine name
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
