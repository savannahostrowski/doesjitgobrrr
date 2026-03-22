import { type Component, type Setter, onCleanup, createEffect, createMemo, For, on, Show } from 'solid-js';
import type { Data, Layout, Config } from 'plotly.js';

import type { BenchmarkRun, DateRange, GoalLines, MachinesMap } from '../types';
import { machinesResource as machines } from '../api';

// Plotly is loaded via CDN in index.html
declare const Plotly: typeof import('plotly.js');
import { useTheme } from '../ThemeContext';
import CustomGoalInput from './CustomGoalInput';
import { MOBILE_BREAKPOINT } from '../constants';
import './PerformanceChart.css';

const DEFAULT_COLOR = '#71717a';

// Theme colors – professional: readable, structured, confident
const COLORS = {
  text: {
    dark: '#d4d4d8',
    light: '#3f3f46',
  },
  title: {
    dark: '#a1a1aa',
    light: '#52525b',
  },
  grid: {
    dark: 'rgba(255, 255, 255, 0.06)',
    light: 'rgba(0, 0, 0, 0.06)',
  },
  zeroline: {
    dark: 'rgba(255, 255, 255, 0.2)',
    light: 'rgba(0, 0, 0, 0.15)',
  },
  markerOutline: {
    dark: '#18181b',
    light: '#ffffff',
  },
  hoverBg: {
    dark: '#1c1c1f',
    light: '#ffffff',
  },
  hoverBorder: {
    dark: '#3f3f46',
    light: '#d4d4d8',
  },
  hintText: '#71717a',
} as const;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

// Goal line colors – muted but readable
const GOAL_LINE_COLORS = {
  5: '#f59e0b',      // amber
  10: '#ef4444',     // red
  custom: '#06b6d4', // cyan
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

function buildGoalLineShape(
  y: number,
  color: string,
  labelFull: string,
  labelShort: string,
  isMobile: boolean
): { shape: NonNullable<Partial<Layout>['shapes']>[number]; annotation: NonNullable<Partial<Layout>['annotations']>[number] } {
  return {
    shape: {
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      yref: 'y',
      y0: y,
      y1: y,
      line: {
        color,
        width: 1.5,
        dash: 'dash',
      },
    },
    annotation: {
      xref: 'paper',
      x: 1,
      yref: 'y',
      y: y,
      text: isMobile ? labelShort : labelFull,
      showarrow: false,
      font: { color, size: 10 },
      xanchor: 'left',
      yanchor: 'middle',
      xshift: 6,
      opacity: 0.8,
    },
  };
}



/** Create Plotly traces from grouped machine data */
function createTraces(
  jitRunsByMachine: Map<string, ParsedRun[]>,
  mode: ThemeMode,
  machines: MachinesMap
): Data[] {
  const sortedMachines = Array.from(jitRunsByMachine.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));

  const traces: Data[] = sortedMachines.map(([machine, runs], index) => {
    const color = machines[machine]?.color || DEFAULT_COLOR;
    const arch = machines[machine]?.arch || 'unknown';
    // Only show "Click to view details" hint on the last trace to avoid duplication in unified hover
    const hoverHint = index === sortedMachines.length - 1
      ? `<br><span style="font-size:11px;color:${COLORS.hintText}">Click to view details</span>`
      : '';

    return {
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: `${machine} (${arch})`,
      x: runs.map(r => r.dateStr),
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
        width: 2.5,
        shape: 'spline',
        smoothing: 0.8,
      },
      marker: {
        color,
        size: 7,
        symbol: 'circle',
        line: {
          color: COLORS.markerOutline[mode],
          width: 2,
        },
      },
    };
  });

  return traces;
}

/** Compute a symmetric y-axis range and ticks that fit all data + goal lines */
function computeYAxis(
  jitRunsByMachine: Map<string, ParsedRun[]>,
  goalLines: GoalLines,
  isMobile: boolean,
): { range: [number, number]; tickvals: number[]; ticktext: string[] } {
  // Collect all y-values (performance difference %)
  let maxAbs = 20; // minimum range
  jitRunsByMachine.forEach(runs => {
    runs.forEach(r => {
      const speedup = r.speedup || 1.0;
      const yVal = Math.abs((1 - speedup) * 100);
      if (yVal > maxAbs) maxAbs = yVal;
    });
  });

  // Also account for goal lines
  if (goalLines.show5) maxAbs = Math.max(maxAbs, 5);
  if (goalLines.show10) maxAbs = Math.max(maxAbs, 10);
  if (goalLines.custom !== null) maxAbs = Math.max(maxAbs, goalLines.custom);

  // Round up to next multiple of 5, with a little padding
  const limit = Math.ceil((maxAbs + 2) / 5) * 5;

  // Build tick values every 5%
  const tickvals: number[] = [];
  for (let v = -limit; v <= limit; v += 5) {
    tickvals.push(v);
  }

  const ticktext = tickvals.map((v) => {
    const label = v >= 0 ? `+${v}%` : `${v}%`;
    if (!isMobile && v === -limit) return `${v}% (faster)`;
    if (!isMobile && v === limit) return `+${v}% (slower)`;
    if (v === 0) return '0%';
    return label;
  });

  return { range: [-limit, limit], tickvals, ticktext };
}

/** Create Plotly layout configuration */
function createLayout(mode: ThemeMode, goalLines: GoalLines, jitRunsByMachine: Map<string, ParsedRun[]>): Partial<Layout> {
  const textColor = COLORS.text[mode];
  const titleColor = COLORS.title[mode];
  const gridColor = COLORS.grid[mode];

  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  const titleSize = isMobile ? 14 : 16;
  const yAxisTitleSize = isMobile ? 11 : 13;
  const tickFontSize = isMobile ? 10 : 11;
  const leftMargin = isMobile ? 68 : 95;
  const hasGoalLines = goalLines.show5 || goalLines.show10 || goalLines.custom !== null;
  const rightMargin = hasGoalLines ? (isMobile ? 70 : 90) : 10;

  // Build goal line shapes
  const shapes: Partial<Layout>['shapes'] = [];
  const annotations: Partial<Layout>['annotations'] = [];

  const goalEntries: Array<{ active: boolean; y: number; color: string; labelFull: string; labelShort: string }> = [
    { active: goalLines.show5, y: 5, color: GOAL_LINE_COLORS[5], labelFull: '5% faster', labelShort: '5%' },
    { active: goalLines.show10, y: 10, color: GOAL_LINE_COLORS[10], labelFull: '10% faster', labelShort: '10%' },
    { active: goalLines.custom !== null, y: goalLines.custom ?? 0, color: GOAL_LINE_COLORS.custom, labelFull: `${goalLines.custom}% faster`, labelShort: `${goalLines.custom}%` },
  ];

  for (const entry of goalEntries) {
    if (entry.active) {
      const { shape, annotation } = buildGoalLineShape(-entry.y, entry.color, entry.labelFull, entry.labelShort, isMobile);
      shapes.push(shape);
      annotations.push(annotation);
    }
  }

  return {
    title: {
      text: 'JIT vs. Interpreter · Geometric Mean',
      font: {
        family: 'Sora, -apple-system, BlinkMacSystemFont, sans-serif',
        size: titleSize,
        color: titleColor,
      },
      x: 0.5,
      xanchor: 'center' as const,
    },
    xaxis: {
      tickfont: {
        family: 'Sora, -apple-system, BlinkMacSystemFont, sans-serif',
        color: textColor,
        size: tickFontSize,
      },
      gridcolor: gridColor,
      linecolor: 'transparent',
      tickformat: '%b %d',
      showline: false,
    },
    yaxis: {
      title: {
        text: 'Performance Difference',
        font: {
          family: 'Sora, -apple-system, BlinkMacSystemFont, sans-serif',
          color: titleColor,
          size: yAxisTitleSize,
        },
        standoff: isMobile ? 10 : 16,
      },
      tickfont: {
        family: 'Sora, -apple-system, BlinkMacSystemFont, sans-serif',
        color: textColor,
        size: tickFontSize,
      },
      gridcolor: gridColor,
      linecolor: 'transparent',
      showline: false,
      zeroline: true,
      zerolinecolor: COLORS.zeroline[mode],
      zerolinewidth: 1.5,
      ...computeYAxis(jitRunsByMachine, goalLines, isMobile),
    },
    showlegend: false,
    hovermode: 'x unified' as const,
    hoverlabel: {
      bgcolor: COLORS.hoverBg[mode],
      bordercolor: COLORS.hoverBorder[mode],
      font: {
        color: mode === 'dark' ? '#fafafa' : '#18181b',
        family: 'Sora, -apple-system, BlinkMacSystemFont, sans-serif',
        size: 12,
      },
    },
    plot_bgcolor: 'rgba(0,0,0,0)',
    paper_bgcolor: 'rgba(0,0,0,0)',
    margin: { t: isMobile ? 50 : 60, r: rightMargin, b: 40, l: leftMargin },
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

const PerformanceChart: Component<PerformanceChartProps> = (props) => {
  let chartDiv: HTMLDivElement | undefined;
  const { theme } = useTheme();
  // Parse dates once upfront for all JIT runs with valid speedup
  const parsedJitRuns = createMemo(() => {
    return props.data
      .filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .map(r => {
        const parsedDate = new Date(r.date.split('T')[0] + 'T00:00:00Z');
        const dateStr = parsedDate.toISOString().split('T')[0];
        return {
          ...r,
          parsedDate,
          dateStr,
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
    const machinesData = machines() || {};
    const traces = createTraces(jitRunsByMachine, mode, machinesData);
    const layout = createLayout(mode, props.goalLines, jitRunsByMachine);

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
            // Parse as UTC to avoid timezone issues
            const dateStr = new Date(String(point.x).split('T')[0] + 'T00:00:00Z').toISOString().split('T')[0];
            onPointClick(dateStr);
          }
        }
      });
    });
  };

  createEffect(
    on([() => props.data, theme, () => props.goalLines, machines], () => {
      if (!chartDiv || !machines()) {
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
          <CustomGoalInput
            goalLines={props.goalLines}
            onGoalLinesChange={props.onGoalLinesChange}
            disabled={props.isLoading}
            color={GOAL_LINE_COLORS.custom}
          />
        </div>
      </div>
      <div class={`chart-container ${props.isLoading ? 'chart-loading' : ''}`}>
        <div
          ref={chartDiv}
          role="img"
          aria-label="JIT vs interpreter geometric mean speedup over time. Click a data point to view detailed benchmark results for that date."
          style={{ width: '100%', height: '100%', cursor: 'pointer' }}
        />
      </div>
      <div class="chart-legend">
        <For each={Object.entries(machines() || {})}>
          {([machine, info]) => (
            <div class="legend-item">
              <span class="legend-color" style={{ background: info.color }} />
              <span class="legend-label">{machine} ({info.arch})</span>
            </div>
          )}
        </For>
      </div>
      <p class="chart-subtext">
        <a href="/about">Learn more about these benchmark runs and machines</a>
      </p>
    </div>
  );
};

export default PerformanceChart;
