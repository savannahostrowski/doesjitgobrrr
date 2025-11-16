import { type Component, createSignal, For } from 'solid-js';
import type { ComparisonRow, SortColumn, SortDirection } from '../types';
import { formatTime } from '../utils';

interface BenchmarkTableProps {
  data: ComparisonRow[];
}

const BenchmarkTable: Component<BenchmarkTableProps> = (props) => {
  const [sortColumn, setSortColumn] = createSignal<SortColumn>('name');
  const [sortDirection, setSortDirection] = createSignal<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = createSignal('');

  const handleSort = (column: SortColumn) => {
    if (sortColumn() === column) {
      setSortDirection(sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedData = () => {
    const col = sortColumn();
    const dir = sortDirection();

    return [...props.data].sort((a, b) => {
      let aVal = a[col];
      let bVal = b[col];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (dir === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });
  };

  const filteredData = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return sortedData();

    return sortedData().filter(row =>
      row.name.toLowerCase().includes(query)
    );
  };

  const getRowClass = (benchmark: ComparisonRow): string => {
    if (benchmark.speedup !== null) {
      if (benchmark.speedup < 1) return 'jit-slower';
      if (benchmark.speedup > 1.05) return 'jit-faster';
    }
    return '';
  };

  const formatDiff = (benchmark: ComparisonRow) => {
    if (benchmark.diff === null) return { text: '-', class: 'neutral' };

    if (Math.abs(benchmark.diff) < 0.0000001) {
      return { text: '~0 s', class: 'neutral' };
    } else if (benchmark.diff < 0) {
      return {
        text: formatTime(Math.abs(benchmark.diff)) + ' faster',
        class: 'faster',
      };
    } else {
      return {
        text: formatTime(benchmark.diff) + ' slower',
        class: 'slower',
      };
    }
  };

  const formatSpeedup = (benchmark: ComparisonRow) => {
    if (benchmark.speedup === null) return { text: '-', class: 'neutral' };

    if (benchmark.diff !== null && Math.abs(benchmark.diff) < 0.0000001) {
      return { text: '1.00x', class: 'neutral' };
    }

    const text = benchmark.speedup.toFixed(2) + 'x';
    const className = benchmark.diff !== null && benchmark.diff < 0 ? 'faster' : 'slower';
    return { text, class: className };
  };

  return (
    <section class="benchmarks">
      <h2>Benchmark Results</h2>
      <div class="table-controls">
        <input
          type="text"
          placeholder="Search benchmarks..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th
                data-sort="name"
                classList={{
                  'sort-asc': sortColumn() === 'name' && sortDirection() === 'asc',
                  'sort-desc': sortColumn() === 'name' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('name')}
              >
                Benchmark Name <span class="sort-indicator" />
              </th>
              <th
                data-sort="nonjit_mean"
                classList={{
                  'sort-asc': sortColumn() === 'nonjit_mean' && sortDirection() === 'asc',
                  'sort-desc': sortColumn() === 'nonjit_mean' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('nonjit_mean')}
              >
                Non-JIT Mean <span class="sort-indicator" />
              </th>
              <th
                data-sort="jit_mean"
                classList={{
                  'sort-asc': sortColumn() === 'jit_mean' && sortDirection() === 'asc',
                  'sort-desc': sortColumn() === 'jit_mean' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('jit_mean')}
              >
                JIT Mean <span class="sort-indicator" />
              </th>
              <th
                data-sort="diff"
                classList={{
                  'sort-asc': sortColumn() === 'diff' && sortDirection() === 'asc',
                  'sort-desc': sortColumn() === 'diff' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('diff')}
              >
                Difference <span class="sort-indicator" />
              </th>
              <th
                data-sort="speedup"
                classList={{
                  'sort-asc': sortColumn() === 'speedup' && sortDirection() === 'asc',
                  'sort-desc': sortColumn() === 'speedup' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('speedup')}
              >
                Speedup <span class="sort-indicator" />
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={filteredData()}>
              {(benchmark) => {
                const diff = formatDiff(benchmark);
                const speedup = formatSpeedup(benchmark);
                return (
                  <tr class={getRowClass(benchmark)}>
                    <td>{benchmark.name}</td>
                    <td>{benchmark.nonjit_mean ? formatTime(benchmark.nonjit_mean) : '-'}</td>
                    <td>{benchmark.jit_mean ? formatTime(benchmark.jit_mean) : '-'}</td>
                    <td class={diff.class}>{diff.text}</td>
                    <td class={speedup.class}>{speedup.text}</td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default BenchmarkTable;
