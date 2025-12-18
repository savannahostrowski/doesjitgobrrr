import { type Component, createMemo, createSignal, For, Show } from 'solid-js';
import type { BenchmarkRun, ComparisonRow } from '../types';
import BenchmarkTable from './BenchmarkTable';
import { getArchitecture, compareValues, formatSpeedup, formatSpeedupPercent } from '../utils';

interface DetailViewProps {
  runs: BenchmarkRun[];
  onBack: () => void;
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
    if (!runs) return '0 benchmarks';

    const count = Object.keys(runs.nonJit.benchmarks).length;
    return `${count} benchmarks`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getRawDataUrl = (run: BenchmarkRun) => {
    // Use the directory name directly from the database
    return `https://github.com/savannahostrowski/pyperf_bench/tree/main/results/${run.directory_name}`;
  };

  const getSpeedupForMachine = (machine: string) => {
    const runs = runsByMachine().get(machine);
    if (!runs || !runs.jit.speedup) return null;
    return formatSpeedupPercent(runs.jit.speedup);
  };

  return (
    <>
      <div class="back-button-container">
        <button class="back-button" onClick={() => props.onBack()}>
          ← Back to Home
        </button>
      </div>

      <section class="summary-compact">
        <h2>Benchmark Run Details</h2>
        <ul class="summary-list">
          <li>
            <span class="label">Date:</span> {primaryRun() ? formatDate(primaryRun()!.date) : '-'}
          </li>
          <li>
            <span class="label">Python Version:</span> {primaryRun()?.python_version || '-'}
          </li>
          <li>
            <span class="label">Commit:</span>{' '}
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
          </li>
        </ul>

        <div class="machine-stats-grid">
          <For each={availableMachines()}>
            {(machine) => {
              const runs = runsByMachine().get(machine)!;
              const speedupData = getSpeedupForMachine(machine);
              const hasTailcall = runs.jit.has_tailcall || runs.nonJit.has_tailcall;
              return (
                <div class="machine-stats-card">
                  <h3 class="machine-stats-heading">
                    <span>{machine} ({getArchitecture(machine)})</span>
                    <Show when={hasTailcall}>
                      <span class="badge tailcall">tail calls enabled</span>
                    </Show>
                  </h3>
                  <ul class="machine-stats-list">
                    <li>
                      <span class="label">Benchmarks:</span> {totalBenchmarksForMachine(machine)}
                    </li>
                    <Show when={speedupData !== null}>
                      <li>
                        <span class="label">Geometric Mean:</span>{' '}
                        <span class={speedupData!.className}>{speedupData!.text}</span>
                      </li>
                    </Show>
                    <Show when={runs.jit.hpt?.percentile_99}>
                      <li>
                        <span class="label">HPT 99th %ile:</span> {runs.jit.hpt!.percentile_99?.toFixed(2)}x
                      </li>
                    </Show>
                    <li>
                      <span class="label">Raw Data:</span>{' '}
                      <a
                        href={getRawDataUrl(runs.jit)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        JIT
                      </a>
                      {', '}
                      <a
                        href={getRawDataUrl(runs.nonJit)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Interpreter
                      </a>
                    </li>
                  </ul>
                </div>
              );
            }}
          </For>
        </div>
      </section>

      {/* Tabs */}
      <Show when={availableMachines().length > 0}>
        <div class="benchmark-tabs">
          <For each={availableMachines()}>
            {(machine) => (
              <button
                class={selectedTab() === machine ? 'tab active' : 'tab'}
                onClick={() => setSelectedTab(machine)}
              >
                {machine} ({getArchitecture(machine)})
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
            <input
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
        </section>
      </Show>

      {/* Individual machine tables */}
      <For each={availableMachines()}>
        {(machine) => (
          <Show when={selectedTab() === machine}>
            <BenchmarkTable
              data={comparisonDataForMachine(machine)}
              title={`Benchmark Results - ${machine}`}
            />
          </Show>
        )}
      </For>
    </>
  );
};

export default DetailView;
