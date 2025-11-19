import { type Component, createSignal, For, Show } from 'solid-js';
import type { BenchmarkRun, ComparisonRow } from '../types';
import BenchmarkTable from './BenchmarkTable';
import { getArchitecture } from '../utils';

interface DetailViewProps {
  runs: BenchmarkRun[];
  onBack: () => void;
}

interface MachineComparisonRow {
  name: string;
  speedups: Record<string, number | null>;
  delta: number | null; // Difference between machines (if 2 machines)
}

const DetailView: Component<DetailViewProps> = (props) => {
  // Group runs by machine
  const runsByMachine = () => {
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
  };

  const availableMachines = () => Array.from(runsByMachine().keys()).sort();
  const [selectedTab, setSelectedTab] = createSignal<string>(
    availableMachines()[0] || 'compare'
  );

  // Sorting state for comparison table
  type CompareSortColumn = 'name' | 'delta' | string; // string for machine names
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

      // Calculate delta if exactly 2 machines
      let delta: number | null = null;
      if (machines.length === 2) {
        const [m1, m2] = machines;
        if (speedups[m1] !== null && speedups[m2] !== null) {
          delta = speedups[m2]! - speedups[m1]!;
        }
      }

      return { name, speedups, delta };
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
      let aVal: string | number | null;
      let bVal: string | number | null;

      if (col === 'name') {
        aVal = a.name;
        bVal = b.name;
      } else if (col === 'delta') {
        aVal = a.delta;
        bVal = b.delta;
      } else {
        // Sorting by machine speedup
        aVal = a.speedups[col] ?? null;
        bVal = b.speedups[col] ?? null;
      }

      // Handle null values - always sort them to the end
      const aIsNull = aVal === null || aVal === undefined;
      const bIsNull = bVal === null || bVal === undefined;

      if (aIsNull && bIsNull) return 0;
      if (aIsNull) return 1;
      if (bIsNull) return -1;

      // At this point, both values are non-null
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const aComp = aVal.toLowerCase();
        const bComp = bVal.toLowerCase();
        if (dir === 'asc') {
          return aComp > bComp ? 1 : aComp < bComp ? -1 : 0;
        } else {
          return aComp < bComp ? 1 : aComp > bComp ? -1 : 0;
        }
      } else {
        // Both are numbers
        const aComp = aVal as number;
        const bComp = bVal as number;
        if (dir === 'asc') {
          return aComp > bComp ? 1 : aComp < bComp ? -1 : 0;
        } else {
          return aComp < bComp ? 1 : aComp > bComp ? -1 : 0;
        }
      }
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
    // Format date as YYYYMMDD
    const date = new Date(run.date);
    const formattedDate = date.toISOString().split('T')[0].replace(/-/g, '');

    // Extract version (e.g., "3.15.0a1+")
    const version = run.python_version;

    // Get short commit hash (first 7 chars)
    const shortCommit = run.commit.substring(0, 7);

    // Determine JIT or noJIT
    const jitFlag = run.is_jit ? 'JIT' : 'noJIT';

    // Build directory name: bm-{date}-{version}-{commit}-{JIT/noJIT}
    const dirName = `bm-${formattedDate}-${version}-${shortCommit}-${jitFlag}`;

    return `https://github.com/savannahostrowski/pyperf_bench/tree/main/results/${dirName}`;
  };

  const getSpeedupForMachine = (machine: string) => {
    const runs = runsByMachine().get(machine);
    if (!runs || !runs.jit.speedup) return null;

    const speedup = runs.jit.speedup;
    if (speedup > 1.0) {
      const percentFaster = ((speedup - 1) * 100).toFixed(1);
      return { text: `${percentFaster}% faster`, class: 'faster' };
    } else if (speedup < 1.0) {
      const percentSlower = ((1 - speedup) * 100).toFixed(1);
      return { text: `${percentSlower}% slower`, class: 'slower' };
    } else {
      return { text: 'same speed', class: 'neutral' };
    }
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
          <Show when={runsByMachine().size > 0}>
            <li>
              <span class="label">Raw Data:</span>{' '}
              <Show when={(() => {
                const firstMachine = availableMachines()[0];
                return runsByMachine().get(firstMachine);
              })()} fallback="-">
                {(runs) => (
                  <>
                    <a
                      href={getRawDataUrl(runs().jit)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      JIT
                    </a>
                    {', '}
                    <a
                      href={getRawDataUrl(runs().nonJit)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Interpreter
                    </a>
                  </>
                )}
              </Show>
            </li>
          </Show>
        </ul>

        <div class="machine-stats-grid">
          <For each={availableMachines()}>
            {(machine) => {
              const runs = runsByMachine().get(machine)!;
              const speedupData = getSpeedupForMachine(machine);
              return (
                <div class="machine-stats-card">
                  <h3 class="machine-stats-heading">{machine} ({getArchitecture(machine)})</h3>
                  <ul class="machine-stats-list">
                    <li>
                      <span class="label">Benchmarks:</span> {totalBenchmarksForMachine(machine)}
                    </li>
                    <Show when={speedupData !== null}>
                      <li>
                        <span class="label">Geometric Mean:</span>{' '}
                        <span class={speedupData!.class}>{speedupData!.text}</span>
                      </li>
                    </Show>
                    <Show when={runs.jit.hpt?.percentile_99}>
                      <li>
                        <span class="label">HPT 99th %ile:</span> {runs.jit.hpt!.percentile_99?.toFixed(2)}x
                      </li>
                    </Show>
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
                  <Show when={availableMachines().length === 2}>
                    <th
                      data-sort="delta"
                      classList={{
                        'sort-asc': compareSortColumn() === 'delta' && compareSortDirection() === 'asc',
                        'sort-desc': compareSortColumn() === 'delta' && compareSortDirection() === 'desc',
                      }}
                      onClick={() => handleCompareSort('delta')}
                    >
                      Δ <span class="sort-indicator" />
                    </th>
                  </Show>
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
                          if (speedup === null) return <td>-</td>;

                          let className = 'neutral';
                          let text = '';
                          if (speedup > 1.05) {
                            className = 'faster';
                            text = `${speedup.toFixed(2)}x`;
                          } else if (speedup < 1.0) {
                            className = 'slower';
                            text = `${(1.0 / speedup).toFixed(2)}x slower`;
                          } else {
                            text = `${speedup.toFixed(2)}x`;
                          }

                          return <td class={className}>{text}</td>;
                        }}
                      </For>
                      <Show when={availableMachines().length === 2}>
                        <td class={row.delta !== null && Math.abs(row.delta) > 0.05 ? (row.delta > 0 ? 'faster' : 'slower') : 'neutral'}>
                          {row.delta !== null ? (row.delta > 0 ? `+${(row.delta * 100).toFixed(1)}%` : `${(row.delta * 100).toFixed(1)}%`) : '-'}
                        </td>
                      </Show>
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
