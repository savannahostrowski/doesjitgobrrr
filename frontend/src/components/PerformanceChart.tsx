import { type Component, type Setter, onMount, onCleanup, createEffect, createMemo, createSignal, For, on, Show } from 'solid-js';
import type { Data, Layout, Config, PlotlyHTMLElement } from 'plotly.js';

import type { BenchmarkRun, DateRange, GoalLines } from '../types';
import { isValidGoalValue, GOAL_LINE_MIN, GOAL_LINE_MAX } from '../types';

// Plotly is loaded via CDN in index.html
declare const Plotly: {
  newPlot(
    element: HTMLDivElement,
    data: Data[],
    layout?: Partial<Layout>,
    config?: Partial<Config>
  ): Promise<PlotlyHTMLElement>;
  purge(element: HTMLDivElement): void;
};
import { useTheme } from '../ThemeContext';
import { getArchitecture } from '../utils';

const MACHINE_COLORS: Record<string, string> = {
  'blueberry': '#a855f7',  // purple
  'ripley': '#3b82f6',     // blue
  'jones': '#10b981',      // green
  'unknown': '#6b7280',    // gray fallback
};

// Theme colors
const COLORS = {
  // Text colors
  text: {
    dark: '#e5e7eb',
    light: '#1a1a1a',
  },
  // Title/accent colors
  title: {
    dark: '#c4b5fd',
    light: '#6d28d9',
  },
  // Grid lines
  grid: {
    dark: 'rgba(139, 92, 246, 0.15)',
    light: 'rgba(124, 58, 237, 0.2)',
  },
  // Zero line
  zeroline: {
    dark: 'rgba(139, 92, 246, 0.5)',
    light: 'rgba(124, 58, 237, 0.5)',
  },
  // Marker outline
  markerOutline: {
    dark: '#1a1a1a',
    light: '#ffffff',
  },
  // Hover label
  hoverBg: {
    dark: 'rgba(26, 26, 26, 0.95)',
    light: 'rgba(255, 255, 255, 0.95)',
  },
  hoverBorder: {
    dark: '#8b5cf6',
    light: '#7c3aed',
  },
  // Hint text
  hintText: '#9ca3af',
} as const;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

// Goal line colors - distinct from machine colors (purple, blue, green)
// Using warm/neutral tones that work in both light and dark mode
const GOAL_LINE_COLORS = {
  5: '#f97316',      // orange - visible in both modes, distinct from data
  10: '#ef4444',     // red - clear warning/goal color
  custom: '#06b6d4', // cyan - complements purple theme, distinct from blue
} as const;

interface PerformanceChartProps {
  data: BenchmarkRun[];
  onPointClick: (dateStr: string) => void;
  dateRange: DateRange;
  onDateRangeChange: Setter<DateRange>;
  goalLines: GoalLines;
  onGoalLinesChange: Setter<GoalLines>;
  isLoading?: boolean;
}

// Extended run type with pre-parsed date
type ParsedRun = BenchmarkRun & { parsedDate: Date; dateStr: string };
type ThemeMode = 'dark' | 'light';

/** Group runs by machine and deduplicate to keep only the latest run per day */
function groupAndDeduplicateByMachine(runs: ParsedRun[]): Map<string, ParsedRun[]> {
  const byMachine = new Map<string, ParsedRun[]>();

  // Group by machine
  runs.forEach(run => {
    const machine = run.machine || 'unknown';
    if (!byMachine.has(machine)) {
      byMachine.set(machine, []);
    }
    byMachine.get(machine)!.push(run);
  });

  // Deduplicate: keep only the latest run per day for each machine
  byMachine.forEach((machineRuns, machine) => {
    const runsByDate = new Map<string, ParsedRun>();

    machineRuns.forEach(run => {
      const existing = runsByDate.get(run.dateStr);
      if (!existing || (run.directory_name || '') > (existing.directory_name || '')) {
        runsByDate.set(run.dateStr, run);
      }
    });

    const deduplicated = Array.from(runsByDate.values())
      .sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

    byMachine.set(machine, deduplicated);
  });

  return byMachine;
}

/** Create Plotly traces from grouped machine data */
function createTraces(
  jitRunsByMachine: Map<string, ParsedRun[]>,
  mode: ThemeMode
): Data[] {
  const sortedMachines = Array.from(jitRunsByMachine.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  const traces: Data[] = sortedMachines.map(([machine, runs], index) => {
    const color = MACHINE_COLORS[machine] || MACHINE_COLORS['unknown'];
    // Only show "Click to view details" hint on the last trace to avoid duplication in unified hover
    const hoverHint = index === sortedMachines.length - 1
      ? `<br><span style="font-size:11px;color:${COLORS.hintText}">Click to view details</span>`
      : '';

    return {
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: `${machine} (${getArchitecture(machine)})`,
      x: runs.map(r => r.parsedDate),
      y: runs.map(r => {
        const speedup = r.speedup || 1.0;
        return (1 - speedup) * 100;
      }),
      text: runs.map(r => {
        const speedup = r.speedup || 1.0;
        if (speedup > 1.0) {
          return `${((speedup - 1) * 100).toFixed(1)}% faster`;
        } else if (speedup < 1.0) {
          return `${((1 - speedup) * 100).toFixed(1)}% slower`;
        }
        return 'same speed';
      }),
      customdata: runs.map(r => r.dateStr),
      hovertemplate: `${machine}: %{text}${hoverHint}<extra></extra>`,
      line: {
        color,
        width: 3,
        shape: 'spline',
        smoothing: 0.8,
      },
      marker: {
        color,
        size: 10,
        line: {
          color: COLORS.markerOutline[mode],
          width: 2,
        },
      },
    };
  });

  return traces;
}

/** Create Plotly layout configuration */
function createLayout(mode: ThemeMode, goalLines: GoalLines): Partial<Layout> {
  const textColor = COLORS.text[mode];
  const titleColor = COLORS.title[mode];
  const gridColor = COLORS.grid[mode];

  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  const titleSize = isMobile ? 14 : 18;
  const yAxisTitleSize = isMobile ? 11 : 14;
  const tickFontSize = isMobile ? 10 : 12;
  const leftMargin = isMobile ? 70 : 100;
  const hasGoalLines = goalLines.show5 || goalLines.show10 || goalLines.custom !== null;
  const rightMargin = hasGoalLines ? (isMobile ? 70 : 90) : 10;

  // Build goal line shapes
  const shapes: Partial<Layout>['shapes'] = [];
  const annotations: Partial<Layout>['annotations'] = [];

  if (goalLines.show5) {
    shapes.push({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      yref: 'y',
      y0: -5,
      y1: -5,
      line: {
        color: GOAL_LINE_COLORS[5],
        width: 2,
        dash: 'dash',
      },
    });
    annotations.push({
      xref: 'paper',
      x: 1,
      yref: 'y',
      y: -5,
      text: isMobile ? '5%' : '5% faster',
      showarrow: false,
      font: { color: GOAL_LINE_COLORS[5], size: 11 },
      xanchor: 'left',
      yanchor: 'middle',
      xshift: 8,
    });
  }

  if (goalLines.show10) {
    shapes.push({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      yref: 'y',
      y0: -10,
      y1: -10,
      line: {
        color: GOAL_LINE_COLORS[10],
        width: 2,
        dash: 'dash',
      },
    });
    annotations.push({
      xref: 'paper',
      x: 1,
      yref: 'y',
      y: -10,
      text: isMobile ? '10%' : '10% faster',
      showarrow: false,
      font: { color: GOAL_LINE_COLORS[10], size: 11 },
      xanchor: 'left',
      yanchor: 'middle',
      xshift: 8,
    });
  }

  if (goalLines.custom !== null) {
    shapes.push({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      yref: 'y',
      y0: -goalLines.custom,
      y1: -goalLines.custom,
      line: {
        color: GOAL_LINE_COLORS.custom,
        width: 2,
        dash: 'dash',
      },
    });
    annotations.push({
      xref: 'paper',
      x: 1,
      yref: 'y',
      y: -goalLines.custom,
      text: isMobile ? `${goalLines.custom}%` : `${goalLines.custom}% faster`,
      showarrow: false,
      font: { color: GOAL_LINE_COLORS.custom, size: 11 },
      xanchor: 'left',
      yanchor: 'middle',
      xshift: 8,
    });
  }

  return {
    title: {
      text: '<b>JIT vs. Interpreter Benchmark Execution Time</b><br><sub>(Geometric Mean)</sub>',
      font: {
        family: '-apple-system, BlinkMacSystemFont, segoe ui, Roboto, sans-serif',
        size: titleSize,
        color: titleColor,
      },
      x: 0.5,
      xanchor: 'center' as const,
    },
    xaxis: {
      tickfont: { color: textColor, size: tickFontSize },
      gridcolor: gridColor,
      linecolor: gridColor,
      tickformat: '%b %d',
      hoverformat: '%B %d, %Y',
    },
    yaxis: {
      title: {
        text: '<b>Performance Difference</b>',
        font: { color: titleColor, size: yAxisTitleSize },
        standoff: isMobile ? 10 : 20,
      },
      tickfont: { color: textColor, size: tickFontSize },
      gridcolor: gridColor,
      linecolor: gridColor,
      zeroline: true,
      zerolinecolor: COLORS.zeroline[mode],
      zerolinewidth: 2,
      range: [-20, 20],
      ticksuffix: '%',
      tickvals: [-20, -15, -10, -5, 0, 5, 10, 15, 20],
      ticktext: isMobile
        ? ['-20%', '-15%', '-10%', '-5%', '0%', '+5%', '+10%', '+15%', '+20%']
        : ['-20% (faster)', '-15%', '-10%', '-5%', '0%', '+5%', '+10%', '+15%', '+20% (slower)'],
    },
    showlegend: false,
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: COLORS.hoverBg[mode],
      bordercolor: COLORS.hoverBorder[mode],
      font: {
        color: textColor,
        family: '-apple-system, BlinkMacSystemFont, segoe ui, Roboto, sans-serif',
        size: 13,
      },
    },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    margin: { t: isMobile ? 60 : 80, r: rightMargin, b: 40, l: leftMargin },
    autosize: true,
    shapes,
    annotations,
  };
}

const PLOTLY_CONFIG: Partial<Config> = {
  responsive: true,
  displayModeBar: false,
  scrollZoom: false,
};

// Breakpoint for mobile layout (matches CSS media queries)
const MOBILE_BREAKPOINT = 768;

const PerformanceChart: Component<PerformanceChartProps> = (props) => {
  let chartDiv: HTMLDivElement | undefined;
  const { theme } = useTheme();
  const [customInputError, setCustomInputError] = createSignal<string | null>(null);

  // Parse dates once upfront for all JIT runs with valid speedup
  const parsedJitRuns = createMemo(() => {
    return props.data
      .filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .map(r => {
        const parsedDate = new Date(r.date);
        return {
          ...r,
          parsedDate,
          dateStr: parsedDate.toISOString().split('T')[0],
        };
      }) as ParsedRun[];
  });

  // Compute most recent date from JIT runs
  const mostRecentDate = createMemo(() => {
    const runs = parsedJitRuns();
    if (runs.length === 0) return null;
    const sorted = [...runs].sort((a, b) => b.parsedDate.getTime() - a.parsedDate.getTime());
    return sorted[0].dateStr;
  });

  const renderChart = () => {
    if (!chartDiv) {
      return;
    }

    const mode: ThemeMode = theme() === 'dark' ? 'dark' : 'light';
    const jitRunsByMachine = groupAndDeduplicateByMachine(parsedJitRuns());
    const traces = createTraces(jitRunsByMachine, mode);
    const layout = createLayout(mode, props.goalLines);

    // Capture the click handler to avoid stale closure issues
    const onPointClick = props.onPointClick;
    Plotly.newPlot(chartDiv, traces, layout, PLOTLY_CONFIG).then(() => {
      // Add click handler for points after chart is created
      // @ts-expect-error - Plotly adds 'on' method to the div
      chartDiv.on('plotly_click', (data: { points: Array<{ customdata: string; x: string }> }) => {
        if (data.points && data.points.length > 0) {
          // Find first point with valid customdata
          for (const point of data.points) {
            if (point.customdata) {
              onPointClick(point.customdata);
              return;
            }
          }
          // Fallback: use x value date
          const point = data.points[0];
          if (point.x) {
            const dateStr = new Date(point.x).toISOString().split('T')[0];
            onPointClick(dateStr);
          }
        }
      });
    });
  };

  onMount(() => {
    renderChart();
  });

  createEffect(
    on([() => props.data, theme, () => props.goalLines], () => {
      if (!chartDiv) {
        return;
      }

      Plotly.purge(chartDiv);
      renderChart();
    })
  );

  onCleanup(() => {
    if (chartDiv) {
      Plotly.purge(chartDiv);
    }
  });

  return (
    <div class="chart-section">
      <div class="chart-controls">
        <Show when={mostRecentDate()}>
          {(latestDate) => (
            <>
              <a class="view-latest-link" href={`/run/${latestDate()}`}>
                Latest ({latestDate()}) →
              </a>
              <span class="controls-divider">|</span>
            </>
          )}
        </Show>
        <div class="date-range-filter">
          <For each={DATE_RANGE_OPTIONS}>
            {(option) => (
              <button
                class={`date-range-btn ${props.dateRange === option.value ? 'active' : ''}`}
                onClick={() => props.onDateRangeChange(option.value)}
                disabled={props.isLoading}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <span class="controls-divider">|</span>
        <div class="goal-line-toggles">
          <span class="goal-label">Goals</span>
          <button
            type="button"
            class={`goal-line-btn ${props.goalLines.show5 ? 'active' : ''}`}
            onClick={() => props.onGoalLinesChange(prev => ({ ...prev, show5: !prev.show5 }))}
            disabled={props.isLoading}
            title="5% faster (3.15 goal)"
          >
            <span class="goal-line-indicator" style={{ background: GOAL_LINE_COLORS[5] }} />
            5% (3.15)
          </button>
          <button
            type="button"
            class={`goal-line-btn ${props.goalLines.show10 ? 'active' : ''}`}
            onClick={() => props.onGoalLinesChange(prev => ({ ...prev, show10: !prev.show10 }))}
            disabled={props.isLoading}
            title="10% faster (3.16 goal)"
          >
            <span class="goal-line-indicator" style={{ background: GOAL_LINE_COLORS[10] }} />
            10% (3.16)
          </button>
          <div class={`custom-goal-input ${props.goalLines.custom !== null ? 'has-value' : ''} ${customInputError() ? 'has-error' : ''}`}>
            <span class="goal-line-indicator" style={{ background: GOAL_LINE_COLORS.custom }} />
            <input
              type="number"
              min={GOAL_LINE_MIN}
              max={GOAL_LINE_MAX}
              step="1"
              placeholder="Custom %"
              value={props.goalLines.custom !== null ? `${props.goalLines.custom}` : ''}
              onKeyDown={(e) => {
                // Block non-numeric keys (e, E, +, -, .)
                if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                  e.preventDefault();
                }
              }}
              onInput={(e) => {
                const val = e.currentTarget.value;
                if (val === '') {
                  setCustomInputError(null);
                  props.onGoalLinesChange(prev => ({ ...prev, custom: null }));
                } else {
                  const num = parseInt(val, 10);
                  if (isValidGoalValue(num)) {
                    setCustomInputError(null);
                    props.onGoalLinesChange(prev => ({ ...prev, custom: num }));
                  } else {
                    setCustomInputError(`${GOAL_LINE_MIN}-${GOAL_LINE_MAX} only`);
                  }
                }
              }}
              onBlur={() => setCustomInputError(null)}
              disabled={props.isLoading}
              title={`Custom goal line (${GOAL_LINE_MIN}-${GOAL_LINE_MAX}%)`}
            />
            <Show when={customInputError()}>
              <span class="custom-goal-error">{customInputError()}</span>
            </Show>
            <Show when={!customInputError() && props.goalLines.custom !== null}>
              <button
                type="button"
                class="custom-goal-clear"
                onClick={() => props.onGoalLinesChange(prev => ({ ...prev, custom: null }))}
                title="Clear"
              >
                ×
              </button>
            </Show>
          </div>
        </div>
      </div>
      <div class={`chart-container ${props.isLoading ? 'chart-loading' : ''}`}>
        <div ref={chartDiv} style={{ width: '100%', height: '100%', cursor: 'pointer' }} />
      </div>
      <div class="chart-legend">
        <For each={Object.entries(MACHINE_COLORS).filter(([m]) => m !== 'unknown')}>
          {([machine, color]) => (
            <div class="legend-item">
              <span class="legend-color" style={{ background: color }} />
              <span class="legend-label">{machine} ({getArchitecture(machine)})</span>
            </div>
          )}
        </For>
      </div>
      <p class="chart-subtext">
        <a href="/about">Learn more about these benchmark runs</a>
      </p>
    </div>
  );
};

export default PerformanceChart;
