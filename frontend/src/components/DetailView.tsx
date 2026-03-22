import { type Component, createMemo, createSignal, For, Show } from 'solid-js';
import type { BenchmarkRun, ComparisonRow } from '../types';
import BenchmarkTable from './BenchmarkTable';
import './DetailView.css';
import { compareValues, formatSpeedup, formatSpeedupPercent } from '../utils';
import { machinesResource as machines } from '../api';

interface DetailViewProps {
  runs: BenchmarkRun[];
  prevDate: string | null;
  nextDate: string | null;
}

interface MachineComparisonRow {
  name: string;
  speedups: Record<string, number | null>;
}

const DetailView: Component<DetailViewProps> = (props) => {
  // Group runs by machine - memoized to avoid recomputation
  const runsByMachine = createMemo(() => {
    const grouped = new Map<string, { nonJit?: BenchmarkRun; jit?: BenchmarkRun }>();

    props.runs.forEach(run => {
      const machine = run.machine || 'unknown';
      if (!grouped.has(machine)) {
        grouped.set(machine, {});
      }

      const machineRuns = grouped.get(machine)!;
      if (run.is_jit) {
        machineRuns.jit = run;
      } else {
        machineRuns.nonJit = run;
      }
    });

    // Filter out machines that don't have both JIT and non-JIT runs
    const filtered = new Map<string, { nonJit: BenchmarkRun; jit: BenchmarkRun }>();
    grouped.forEach((runs, machine) => {
      if (runs.nonJit && runs.jit) {
        filtered.set(machine, { nonJit: runs.nonJit, jit: runs.jit });
      }
    });

    return filtered;
  });

  const availableMachines = createMemo(() => Array.from(runsByMachine().keys()).sort());
  // Initialize selectedTab lazily - use first machine or 'compare'
  const getInitialTab = () => availableMachines()[0] || 'compare';
  const [selectedTab, setSelectedTab] = createSignal<string>(getInitialTab());

  // Sorting state for comparison table
  type CompareSortColumn = 'name' | string; // string for machine names
  const [compareSortColumn, setCompareSortColumn] = createSignal<CompareSortColumn>('name');
  const [compareSortDirection, setCompareSortDirection] = createSignal<'asc' | 'desc'>('asc');
  const [compareSearchQuery, setCompareSearchQuery] = createSignal('');

  const handleCompareSort = (column: CompareSortColumn) => {
    if (compareSortColumn() === column) {
      setCompareSortDirection(compareSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      setCompareSortColumn(column);
      setCompareSortDirection('asc');
    }
  };

  // Get primary run for metadata (use first available machine)
  const primaryRun = () => {
    const machines = runsByMachine();
    const firstMachine = availableMachines()[0];
    if (!firstMachine) return null;

    const runs = machines.get(firstMachine);
    return runs?.nonJit || runs?.jit || null;
  };

  const comparisonDataForMachine = (machine: string): ComparisonRow[] => {
    const runs = runsByMachine().get(machine);
    if (!runs) return [];

    const allBenchmarks = new Set<string>();
    const nonJit = runs.nonJit;
    const jit = runs.jit;

    Object.keys(nonJit.benchmarks).forEach(name => allBenchmarks.add(name));
    Object.keys(jit.benchmarks).forEach(name => allBenchmarks.add(name));

    return Array.from(allBenchmarks)
      .map(name => {
        const nonJitMean = nonJit.benchmarks[name]?.mean ?? null;
        const jitMean = jit.benchmarks[name]?.mean ?? null;

        let diff: number | null = null;
        let speedup: number | null = null;

        if (nonJitMean !== null && jitMean !== null) {
          diff = jitMean - nonJitMean;
          speedup = nonJitMean / jitMean;
        }

        return {
          name,
          nonjit_mean: nonJitMean,
          jit_mean: jitMean,
          diff,
          speedup,
        };
      })
      .filter(row => row.nonjit_mean !== null && row.jit_mean !== null);
  };

  const comparisonDataAcrossMachines = (): MachineComparisonRow[] => {
    const machines = availableMachines();
    if (machines.length === 0) return [];

    // Get all unique benchmark names across all machines
    const allBenchmarkNames = new Set<string>();
    machines.forEach(machine => {
      const runs = runsByMachine().get(machine);
      if (runs) {
        Object.keys(runs.nonJit.benchmarks).forEach(name => allBenchmarkNames.add(name));
      }
    });

    let data = Array.from(allBenchmarkNames).map(name => {
      const speedups: Record<string, number | null> = {};
      machines.forEach(machine => {
        const runs = runsByMachine().get(machine);
        if (runs) {
          const nonJitMean = runs.nonJit.benchmarks[name]?.mean ?? null;
          const jitMean = runs.jit.benchmarks[name]?.mean ?? null;
          if (nonJitMean !== null && jitMean !== null) {
            speedups[machine] = nonJitMean / jitMean;
          } else {
            speedups[machine] = null;
          }
        }
      });

      return { name, speedups };
    }).filter(row => Object.values(row.speedups).some(v => v !== null));

    // Filter by search query
    const query = compareSearchQuery().toLowerCase();
    if (query) {
      data = data.filter(row => row.name.toLowerCase().includes(query));
    }

    // Sort data
    const col = compareSortColumn();
    const dir = compareSortDirection();

    return [...data].sort((a, b) => {
      const aVal = col === 'name' ? a.name : a.speedups[col] ?? null;
      const bVal = col === 'name' ? b.name : b.speedups[col] ?? null;
      return compareValues(aVal, bVal, dir);
    });
  };

  const totalBenchmarksForMachine = (machine: string) => {
    const runs = runsByMachine().get(machine);
    if (!runs) return 0;
    return Object.keys(runs.nonJit.benchmarks).length;
  };

  const formatDate = (dateStr: string) => {
    // Parse as UTC to avoid timezone issues
    return new Date(dateStr.split('T')[0] + 'T00:00:00Z').toLocaleDateString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getRawDataUrl = (run: BenchmarkRun) => {
    const repo = machines()?.[run.machine]?.repo;
    return repo
      ? `https://github.com/${repo}/tree/main/results/${run.directory_name}`
      : `#`;
  };

  const getSpeedupForMachine = (machine: string) => {
    const runs = runsByMachine().get(machine);
    if (!runs || !runs.jit.speedup) return null;
    return formatSpeedupPercent(runs.jit.speedup);
  };

  return (
    <>
      {/* Run date navigation */}
      <div class="run-nav">
        <Show
          when={props.prevDate}
          fallback={<span class="run-nav-btn disabled" aria-disabled="true">← Prev</span>}
        >
          <a href={`/run/${props.prevDate}`} class="run-nav-btn">← Prev</a>
        </Show>
        <span class="run-nav-date">
          {primaryRun() ? formatDate(primaryRun()!.date) : ''}
        </span>
        <Show
          when={props.nextDate}
          fallback={<span class="run-nav-btn disabled" aria-disabled="true">Next →</span>}
        >
          <a href={`/run/${props.nextDate}`} class="run-nav-btn">Next →</a>
        </Show>
      </div>

      {/* Run metadata bar */}
      <div class="run-meta-bar">
        <div class="run-meta-item">
          <span class="run-meta-label">Python</span>
          <span class="run-meta-value">{primaryRun()?.python_version || '-'}</span>
        </div>
        <div class="run-meta-divider" />
        <div class="run-meta-item">
          <span class="run-meta-label">Commit</span>
          <span class="run-meta-value">
            {primaryRun() ? (
              <a
                href={`https://github.com/python/cpython/commit/${primaryRun()!.commit}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {primaryRun()!.commit.substring(0, 7)}
              </a>
            ) : (
              '-'
            )}
          </span>
        </div>
      </div>

      {/* Machine performance cards */}
      <div class="machine-cards-grid">
        <For each={availableMachines()}>
          {(machine) => {
            const runs = runsByMachine().get(machine)!;
            const speedupData = getSpeedupForMachine(machine);
            const hasTailcall = runs.jit.has_tailcall || runs.nonJit.has_tailcall;
            const benchmarkCount = totalBenchmarksForMachine(machine);
            return (
              <div class="machine-perf-card">
                <div class="machine-perf-header">
                  <div class="machine-perf-name">
                    <span class="machine-perf-machine">{machine}</span>
                    <span class="machine-perf-arch">{machines()?.[machine]?.arch || 'unknown'}</span>
                  </div>
                  <Show when={hasTailcall}>
                    <span class="badge tailcall">tail calls</span>
                  </Show>
                </div>

                <Show when={speedupData !== null}>
                  <div class="machine-perf-hero">
                    <span class={`machine-perf-value ${speedupData!.className}`}>{speedupData!.text}</span>
                    <span class="machine-perf-sublabel">geometric mean</span>
                  </div>
                </Show>

                <div class="machine-perf-stats">
                  <div class="machine-perf-stat">
                    <span class="machine-perf-stat-value">{benchmarkCount}</span>
                    <span class="machine-perf-stat-label">benchmarks</span>
                  </div>
                  <Show when={runs.jit.hpt?.percentile_99}>
                    <div class="machine-perf-stat">
                      <span class="machine-perf-stat-value">{runs.jit.hpt!.percentile_99?.toFixed(2)}x</span>
                      <span class="machine-perf-stat-label">HPT p99</span>
                    </div>
                  </Show>
                </div>

                <div class="machine-perf-links">
                  <a href={getRawDataUrl(runs.jit)} target="_blank" rel="noopener noreferrer">
                    JIT data ↗
                  </a>
                  <a href={getRawDataUrl(runs.nonJit)} target="_blank" rel="noopener noreferrer">
                    Interpreter data ↗
                  </a>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* Tabs */}
      <Show when={availableMachines().length > 0}>
        <div class="benchmark-tabs">
          <For each={availableMachines()}>
            {(machine) => (
              <button
                class={selectedTab() === machine ? 'tab active' : 'tab'}
                onClick={() => setSelectedTab(machine)}
              >
                {machine} ({machines()?.[machine]?.arch || 'unknown'})
              </button>
            )}
          </For>
          <Show when={availableMachines().length > 1}>
            <button
              class={selectedTab() === 'compare' ? 'tab active' : 'tab'}
              onClick={() => setSelectedTab('compare')}
            >
              Compare
            </button>
          </Show>
        </div>
      </Show>

      {/* Tab content */}
      <Show when={selectedTab() === 'compare' && availableMachines().length > 1}>
        <section class="benchmarks">
          <h2>Cross-Machine Comparison</h2>
          <div class="table-controls">
            <label for="compare-search" class="sr-only">Search benchmarks</label>
            <input
              id="compare-search"
              type="text"
              placeholder="Search benchmarks..."
              value={compareSearchQuery()}
              onInput={(e) => setCompareSearchQuery(e.currentTarget.value)}
            />
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th
                    scope="col"
                    data-sort="name"
                    classList={{
                      'sort-asc': compareSortColumn() === 'name' && compareSortDirection() === 'asc',
                      'sort-desc': compareSortColumn() === 'name' && compareSortDirection() === 'desc',
                    }}
                    onClick={() => handleCompareSort('name')}
                  >
                    Benchmark Name <span class="sort-indicator" />
                  </th>
                  <For each={availableMachines()}>
                    {(machine) => (
                      <th
                        scope="col"
                        data-sort={machine}
                        classList={{
                          'sort-asc': compareSortColumn() === machine && compareSortDirection() === 'asc',
                          'sort-desc': compareSortColumn() === machine && compareSortDirection() === 'desc',
                        }}
                        onClick={() => handleCompareSort(machine)}
                      >
                        {machine} Speedup <span class="sort-indicator" />
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={comparisonDataAcrossMachines()}>
                  {(row) => (
                    <tr>
                      <td>{row.name}</td>
                      <For each={availableMachines()}>
                        {(machine) => {
                          const speedup = row.speedups[machine];
                          const formatted = formatSpeedup(speedup);
                          return <td class={formatted.className}>{formatted.text}</td>;
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="table-scroll-hint">← scroll for more columns →</p>
        </section>
      </Show>

      {/* Individual machine tables */}
      <For each={availableMachines()}>
        {(machine) => (
          <Show when={selectedTab() === machine}>
            <BenchmarkTable
              data={comparisonDataForMachine(machine)}
              title={`Benchmark Results — ${machine}`}
            />
          </Show>
        )}
      </For>
    </>
  );
};

export default DetailView;
