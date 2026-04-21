import {
  type Component,
  createSignal,
  For,
  onCleanup,
  onMount,
} from 'solid-js';
import type { ComparisonRow, SortColumn, SortDirection } from '../types';
import { compareValues, formatSpeedup, formatTime } from '../utils';
import './BenchmarkTable.css';

const PYSTON_BENCHMARKS = new Set([
  'aiohttp',
  'djangocms',
  'flaskblogging',
  'gevent_hub',
  'gunicorn',
  'json',
  'mypy2',
  'pycparser',
  'pylint',
  'pytorch_alexnet_inference',
  'thrift',
]);
const SPECIAL_BENCHMARK_NAME_MAPPING: Record<string, string[]> = {
  argparse: ['many_optionals', 'subparsers'],
  async_tree: [
    'async_tree_cpu_io_mixed',
    'async_tree_cpu_io_mixed_tg',
    'async_tree_io',
    'async_tree_io_tg',
    'async_tree_memoization',
    'async_tree_memoization_tg',
    'async_tree_none',
    'async_tree_none_tg',
  ],
  asyncio_tcp: ['asyncio_tcp', 'asyncio_tcp_ssl'],
  base64: [
    'ascii85_large',
    'ascii85_small',
    'base16_large',
    'base16_small',
    'base32_large',
    'base32_small',
    'base64_large',
    'base64_small',
    'base85_large',
    'base85_small',
  ],
  bench_thread_pool: ['concurrent_imap'],
  concurrent_imap: ['bench_mp_pool', 'bench_thread_pool'],
  deepcopy: ['deepcopy', 'deepcopy_memo', 'deepcopy_reduce'],
  fastapi: ['fastapi_http'],
  gc_collect: ['create_gc_cycles'],
  genshi: ['genshi_text', 'genshi_xml'],
  logging: ['logging_format', 'logging_silent', 'logging_simple'],
  networkx: ['connected_components', 'shortest_path', 'k_core'],
  pickle: [
    'pickle_dict',
    'pickle_list',
    'pickle_pure_python',
    'unpickle',
    'unpickle_dict',
    'unpickle_list',
    'unpickle_pure_python',
  ],
  pprint: ['pprint_pformat', 'pprint_safe_repr'],
  python_startup: ['python_startup', 'python_startup_no_site'],
  scimark: [
    'scimark_fft',
    'scimark_lu',
    'scimark_monte_carlo',
    'scimark_sor',
    'scimark_sparse_mat_mult',
  ],
  sqlglot_v2: [
    'sqlglot_v2_optimize',
    'sqlglot_v2_normalize',
    'sqlglot_v2_parse',
    'sqlglot_v2_transpile',
  ],
  sympy: ['sympy_integrate', 'sympy_str', 'sympy_expand', 'sympy_sum'],
  xdsl: ['xdsl_constant_fold'],
  xml_etree: [
    'xml_etree_parse',
    'xml_etree_generate',
    'xml_etree_iterparse',
    'xml_etree_process',
  ],
};

function benchmarkNameUrl(benchmarkName: string): string {
  if (PYSTON_BENCHMARKS.has(benchmarkName)) {
    return `https://github.com/pyston/python-macrobenchmarks/blob/main/benchmarks/bm_${benchmarkName}/run_benchmark.py`;
  }
  const baseName =
    Object.entries(SPECIAL_BENCHMARK_NAME_MAPPING).find(([, variants]) =>
      variants.includes(benchmarkName),
    )?.[0] ?? benchmarkName;
  return `https://github.com/python/pyperformance/blob/main/pyperformance/data-files/benchmarks/bm_${baseName}/run_benchmark.py`;
}

interface BenchmarkTableProps {
  data: ComparisonRow[];
  title?: string;
}

const BenchmarkTable: Component<BenchmarkTableProps> = (props) => {
  const [sortColumn, setSortColumn] = createSignal<SortColumn>('name');
  const [sortDirection, setSortDirection] = createSignal<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = createSignal('');

  let tableWrapperEl!: HTMLDivElement;
  let topScrollEl!: HTMLDivElement;
  let topScrollInnerEl!: HTMLDivElement;

  let tableDragStartX = 0;
  let tableDragScrollLeft = 0;
  let isTableDragging = false;

  const onTableDragStart = (e: MouseEvent) => {
    isTableDragging = true;
    tableDragStartX = e.pageX - tableWrapperEl.offsetLeft;
    tableDragScrollLeft = tableWrapperEl.scrollLeft;
  };

  const onTableDragMove = (e: MouseEvent) => {
    if (!isTableDragging) return;
    e.preventDefault();
    if (!tableWrapperEl.classList.contains('is-dragging')) {
      tableWrapperEl.classList.add('is-dragging');
    }
    const x = e.pageX - tableWrapperEl.offsetLeft;
    tableWrapperEl.scrollLeft = tableDragScrollLeft - (x - tableDragStartX);
  };

  const onTableDragEnd = () => {
    isTableDragging = false;
    tableWrapperEl.classList.remove('is-dragging');
  };

  onMount(() => {
    const syncWidth = () => {
      topScrollInnerEl.style.width = `${tableWrapperEl.scrollWidth}px`;
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(tableWrapperEl);
    onCleanup(() => ro.disconnect());
  });

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
      const aVal = a[col];
      const bVal = b[col];
      return compareValues(aVal, bVal, dir);
    });
  };

  const filteredData = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return sortedData();

    return sortedData().filter((row) => row.name.toLowerCase().includes(query));
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

    // Only show ~0 for truly negligible differences (< 1 nanosecond)
    if (Math.abs(benchmark.diff) < 0.000000001) {
      return { text: '~0 s', class: 'neutral' };
    } else if (benchmark.diff < 0) {
      return {
        text: `${formatTime(Math.abs(benchmark.diff))} faster`,
        class: 'faster',
      };
    } else {
      return {
        text: `${formatTime(benchmark.diff)} slower`,
        class: 'slower',
      };
    }
  };

  const formatBenchmarkSpeedup = (benchmark: ComparisonRow) => {
    const result = formatSpeedup(benchmark.speedup);
    return { text: result.text, class: result.className };
  };

  return (
    <section class="benchmarks">
      <h2>{props.title || 'Benchmark Results'}</h2>
      <div class="table-controls">
        <label for="benchmark-search" class="sr-only">
          Search benchmarks
        </label>
        <input
          id="benchmark-search"
          type="text"
          placeholder="Search benchmarks..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>
      <div
        class="table-scroll-top"
        ref={topScrollEl}
        onScroll={() => {
          tableWrapperEl.scrollLeft = topScrollEl.scrollLeft;
        }}
      >
        <div ref={topScrollInnerEl} />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-to-scroll mouse convenience; keyboard users use native scrolling */}
      <div
        class="table-wrapper"
        ref={tableWrapperEl}
        onScroll={() => {
          topScrollEl.scrollLeft = tableWrapperEl.scrollLeft;
        }}
        onMouseDown={onTableDragStart}
        onMouseMove={onTableDragMove}
        onMouseUp={onTableDragEnd}
        onMouseLeave={onTableDragEnd}
      >
        <table>
          <thead>
            <tr>
              <th
                scope="col"
                data-sort="name"
                classList={{
                  'sort-asc':
                    sortColumn() === 'name' && sortDirection() === 'asc',
                  'sort-desc':
                    sortColumn() === 'name' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('name')}
              >
                Benchmark Name <span class="sort-indicator" />
              </th>
              <th
                scope="col"
                data-sort="nonjit_mean"
                classList={{
                  'sort-asc':
                    sortColumn() === 'nonjit_mean' && sortDirection() === 'asc',
                  'sort-desc':
                    sortColumn() === 'nonjit_mean' &&
                    sortDirection() === 'desc',
                }}
                onClick={() => handleSort('nonjit_mean')}
              >
                Interpreter Mean <span class="sort-indicator" />
              </th>
              <th
                scope="col"
                data-sort="jit_mean"
                classList={{
                  'sort-asc':
                    sortColumn() === 'jit_mean' && sortDirection() === 'asc',
                  'sort-desc':
                    sortColumn() === 'jit_mean' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('jit_mean')}
              >
                JIT Mean <span class="sort-indicator" />
              </th>
              <th
                scope="col"
                data-sort="diff"
                classList={{
                  'sort-asc':
                    sortColumn() === 'diff' && sortDirection() === 'asc',
                  'sort-desc':
                    sortColumn() === 'diff' && sortDirection() === 'desc',
                }}
                onClick={() => handleSort('diff')}
              >
                Difference <span class="sort-indicator" />
              </th>
              <th
                scope="col"
                data-sort="speedup"
                classList={{
                  'sort-asc':
                    sortColumn() === 'speedup' && sortDirection() === 'asc',
                  'sort-desc':
                    sortColumn() === 'speedup' && sortDirection() === 'desc',
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
                const speedup = formatBenchmarkSpeedup(benchmark);
                return (
                  <tr class={getRowClass(benchmark)}>
                    <td>
                      <a
                        href={benchmarkNameUrl(benchmark.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {benchmark.name}
                      </a>
                    </td>
                    <td>
                      {benchmark.nonjit_mean
                        ? formatTime(benchmark.nonjit_mean)
                        : '-'}
                    </td>
                    <td>
                      {benchmark.jit_mean
                        ? formatTime(benchmark.jit_mean)
                        : '-'}
                    </td>
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
