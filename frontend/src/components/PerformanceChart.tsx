import * as echarts from 'echarts';
import {
  type Component,
  createEffect,
  createMemo,
  For,
  on,
  onCleanup,
  type Setter,
  Show,
} from 'solid-js';
import {
  machinesResource as machines,
  perfEventsResource as perfEvents,
} from '../api';
import { MOBILE_BREAKPOINT } from '../constants';
import { useTheme } from '../ThemeContext';
import type {
  BenchmarkRun,
  DateRange,
  GoalLines,
  PerfEvent,
  PerfEventKind,
} from '../types';
import CustomGoalInput from './CustomGoalInput';
import './PerformanceChart.css';

const DEFAULT_COLOR = '#71717a';

const FONT_FAMILY = 'Sora, -apple-system, BlinkMacSystemFont, sans-serif';

const COLORS = {
  text: { dark: '#d4d4d8', light: '#3f3f46' },
  title: { dark: '#a1a1aa', light: '#52525b' },
  grid: { dark: 'rgba(255, 255, 255, 0.06)', light: 'rgba(0, 0, 0, 0.06)' },
  zeroline: { dark: 'rgba(255, 255, 255, 0.2)', light: 'rgba(0, 0, 0, 0.15)' },
  markerOutline: { dark: '#18181b', light: '#ffffff' },
  hoverBg: { dark: '#1c1c1f', light: '#ffffff' },
  hoverBorder: { dark: '#3f3f46', light: '#d4d4d8' },
  hintText: '#71717a',
} as const;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const GOAL_LINE_COLORS = {
  5: '#f59e0b',
  10: '#ef4444',
  custom: '#06b6d4',
} as const;

const EVENT_KIND_COLORS: Record<PerfEventKind, string> = {
  'jit-change': '#a855f7',
  bug: '#ef4444',
  infra: '#3b82f6',
  benchmark: '#10b981',
};

const EVENT_KIND_LABELS: Record<PerfEventKind, string> = {
  'jit-change': 'JIT change',
  bug: 'Bug',
  infra: 'Infra',
  benchmark: 'Benchmark',
};

interface PerformanceChartProps {
  data: BenchmarkRun[];
  onPointClick: (dateStr: string) => void;
  dateRange: DateRange;
  onDateRangeChange: Setter<DateRange>;
  goalLines: GoalLines;
  onGoalLinesChange: Setter<GoalLines>;
  showEvents: boolean;
  onShowEventsChange: Setter<boolean>;
  isLoading?: boolean;
}

type ParsedRun = BenchmarkRun & { parsedDate: Date; dateStr: string };
type ThemeMode = 'dark' | 'light';

/** Group runs by machine and dedupe to keep only the latest run per day. */
function groupAndDeduplicateByMachine(
  runs: ParsedRun[],
): Map<string, ParsedRun[]> {
  const byMachine = new Map<string, ParsedRun[]>();
  for (const run of runs) {
    const m = run.machine || 'unknown';
    if (!byMachine.has(m)) byMachine.set(m, []);
    byMachine.get(m)!.push(run);
  }
  byMachine.forEach((runs, m) => {
    const byDate = new Map<string, ParsedRun>();
    for (const r of runs) {
      const ex = byDate.get(r.dateStr);
      if (!ex || (r.directory_name || '') > (ex.directory_name || '')) {
        byDate.set(r.dateStr, r);
      }
    }
    byMachine.set(
      m,
      Array.from(byDate.values()).sort(
        (a, b) => a.parsedDate.getTime() - b.parsedDate.getTime(),
      ),
    );
  });
  return byMachine;
}

function speedupLabel(speedup: number | null | undefined): string {
  const s = speedup || 1.0;
  if (s > 1.0) return `${((s - 1) * 100).toFixed(1)}% faster`;
  if (s < 1.0) return `${((1 - s) * 100).toFixed(1)}% slower`;
  return 'same speed';
}

function speedupY(speedup: number | null | undefined): number {
  const s = speedup || 1.0;
  return (1 - s) * 100;
}

/** Compute symmetric y-axis range that fits all data + active goal lines. */
function computeYRange(
  jitRunsByMachine: Map<string, ParsedRun[]>,
  goalLines: GoalLines,
): { min: number; max: number; interval: number } {
  let maxAbs = 20;
  jitRunsByMachine.forEach((runs) => {
    for (const r of runs) {
      const v = Math.abs(speedupY(r.speedup));
      if (v > maxAbs) maxAbs = v;
    }
  });
  if (goalLines.show5) maxAbs = Math.max(maxAbs, 5);
  if (goalLines.show10) maxAbs = Math.max(maxAbs, 10);
  if (goalLines.custom !== null) maxAbs = Math.max(maxAbs, goalLines.custom);
  const limit = Math.ceil((maxAbs + 2) / 5) * 5;
  return { min: -limit, max: limit, interval: 5 };
}

const PerformanceChart: Component<PerformanceChartProps> = (props) => {
  let chartDiv: HTMLDivElement | undefined;
  let annotationTooltipRef: HTMLDivElement | undefined;
  let chart: echarts.ECharts | undefined;
  const { theme } = useTheme();

  const parsedJitRuns = createMemo<ParsedRun[]>(() => {
    return props.data
      .filter((r) => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .map((r) => {
        const parsedDate = new Date(`${r.date.split('T')[0]}T00:00:00Z`);
        const dateStr = parsedDate.toISOString().split('T')[0];
        return { ...r, parsedDate, dateStr } as ParsedRun;
      });
  });

  const mostRecentDate = createMemo(() => {
    const runs = parsedJitRuns();
    if (runs.length === 0) return null;
    const sorted = [...runs].sort(
      (a, b) => b.parsedDate.getTime() - a.parsedDate.getTime(),
    );
    return sorted[0].dateStr;
  });

  const buildOption = (): echarts.EChartsOption => {
    const mode: ThemeMode = theme() === 'dark' ? 'dark' : 'light';
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    const jitRunsByMachine = groupAndDeduplicateByMachine(parsedJitRuns());
    const machinesData = machines() || {};
    const events = props.showEvents ? (perfEvents() ?? []) : [];

    const sortedMachines = Array.from(jitRunsByMachine.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    const yRange = computeYRange(jitRunsByMachine, props.goalLines);

    // Visible date range from data — used to filter annotations.
    let minDate = Number.POSITIVE_INFINITY;
    let maxDate = Number.NEGATIVE_INFINITY;
    jitRunsByMachine.forEach((runs) => {
      for (const r of runs) {
        const t = r.parsedDate.getTime();
        if (t < minDate) minDate = t;
        if (t > maxDate) maxDate = t;
      }
    });

    // Goal-line markLine items: dashed horizontal lines + label on the right.
    const goalLineEntries: Array<{ y: number; color: string; label: string }> =
      [];
    if (props.goalLines.show5) {
      goalLineEntries.push({
        y: -5,
        color: GOAL_LINE_COLORS[5],
        label: isMobile ? '5%' : '5% faster',
      });
    }
    if (props.goalLines.show10) {
      goalLineEntries.push({
        y: -10,
        color: GOAL_LINE_COLORS[10],
        label: isMobile ? '10%' : '10% faster',
      });
    }
    if (props.goalLines.custom !== null) {
      goalLineEntries.push({
        y: -props.goalLines.custom,
        color: GOAL_LINE_COLORS.custom,
        label: isMobile
          ? `${props.goalLines.custom}%`
          : `${props.goalLines.custom}% faster`,
      });
    }

    // Always include a zero-line marker so the 0% baseline is visually
    // emphasized; goal lines render alongside it on the first series.
    const markLineData: Array<Record<string, unknown>> = [
      {
        yAxis: 0,
        lineStyle: {
          color: COLORS.zeroline[mode],
          width: 1.5,
          type: 'solid' as const,
        },
        label: { show: false },
      },
    ];
    for (const g of goalLineEntries) {
      markLineData.push({
        yAxis: g.y,
        lineStyle: { color: g.color, type: 'dashed' as const, width: 1.5 },
        label: {
          show: true,
          // 'end' anchors at the right end of the line, outside the plot
          // area, so multiple goal labels don't stack on top of each other.
          position: 'end' as const,
          formatter: g.label,
          color: g.color,
          fontSize: 10,
          fontFamily: FONT_FAMILY,
          padding: [0, 0, 0, 6],
        },
      });
    }
    const goalMarkLine = {
      silent: true,
      symbol: 'none',
      animation: false,
      data: markLineData,
    };

    // Per-machine line series. Each data point carries dateStr + speedup so
    // the click handler can navigate and the tooltip can format speedup.
    const series: echarts.SeriesOption[] = sortedMachines.map(
      ([machine, runs], idx) => {
        const color = machinesData[machine]?.color || DEFAULT_COLOR;
        const lineSeries: echarts.LineSeriesOption = {
          type: 'line',
          name: machine,
          smooth: 0.4,
          symbol: 'circle',
          showSymbol: true,
          symbolSize: 5,
          itemStyle: { color, borderWidth: 0 },
          lineStyle: { color, width: 2.5, cap: 'round' as const },
          emphasis: {
            scale: 1.4,
            disabled: false,
            itemStyle: { color, borderWidth: 0 },
          },
          data: runs.map((r) => ({
            value: [r.dateStr, speedupY(r.speedup)] as [string, number],
            dateStr: r.dateStr,
            speedup: r.speedup,
          })),
          markLine: idx === 0 ? goalMarkLine : undefined,
        };
        return lineSeries;
      },
    );

    // Annotation series: triangle-down markers at the top of the chart with
    // their own tooltip (per-item, not axis-triggered).
    const annotationData = events
      .filter((e) => {
        const t = new Date(`${e.date}T00:00:00Z`).getTime();
        return !Number.isNaN(t) && t >= minDate && t <= maxDate;
      })
      .map((e) => ({
        value: [e.date, yRange.max],
        event: e,
        itemStyle: { color: EVENT_KIND_COLORS[e.kind] ?? DEFAULT_COLOR },
      }));

    if (annotationData.length > 0) {
      series.push({
        type: 'scatter',
        name: '__annotations__',
        // Default 'pin' points down naturally (head up, point on the data
        // value). Sits cleanly at the top of the chart at yRange.max.
        symbol: 'pin',
        symbolSize: 16,
        z: 10,
        // Per-series tooltip with item trigger so it only shows when the
        // cursor is exactly on the marker.
        tooltip: {
          trigger: 'item',
          formatter: (params: unknown) => {
            const p = params as { data: { event: PerfEvent } };
            const e = p.data.event;
            const color = EVENT_KIND_COLORS[e.kind] ?? DEFAULT_COLOR;
            const kind = (EVENT_KIND_LABELS[e.kind] ?? e.kind).toUpperCase();
            const linkButton = e.link
              ? `<a href="${e.link}" target="_blank" rel="noopener noreferrer" ` +
                `style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;` +
                `padding:4px 8px;border-radius:6px;background:${color};color:#fff;` +
                `text-decoration:none;font-size:11px;font-weight:600;line-height:1">` +
                `View source ` +
                `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
                `<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />` +
                `<polyline points="15 3 21 3 21 9" />` +
                `<line x1="10" y1="14" x2="21" y2="3" />` +
                `</svg>` +
                `</a>`
              : '';
            const formattedDate = (() => {
              const [y, m, d] = e.date.split('-').map(Number);
              if (!y || !m || !d) return e.date;
              return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
                undefined,
                {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                },
              );
            })();
            return (
              `<div style="font-size:10px;font-weight:600;letter-spacing:0.06em;color:${color};margin-bottom:4px">` +
              `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle"></span>${kind}` +
              `</div>` +
              `<div style="font-weight:600;max-width:240px;text-wrap:pretty;overflow-wrap:anywhere">${e.title.replace(/</g, '&lt;')}</div>` +
              `<div style="margin-top:4px;color:#a1a1aa;font-size:11px">${formattedDate}</div>` +
              linkButton
            );
          },
          extraCssText:
            'pointer-events: auto; padding: 7px 10px; line-height: 1.35;',
          enterable: true,
          // Long-ish delay so the user can move from marker to tooltip and
          // click the link icon without it vanishing first.
          hideDelay: 300,
          // Anchor tooltip directly below the marker (no gap) so the cursor
          // can travel from pin → tooltip without leaving a hover region.
          position: (
            _point: [number, number],
            _params: unknown,
            _dom: HTMLElement,
            rect: { x: number; y: number; width: number; height: number },
            size: { contentSize: [number, number] },
          ) => {
            const x = rect.x + rect.width / 2 - size.contentSize[0] / 2;
            const y = rect.y + rect.height - 4; // slight overlap with the pin
            return [x, y];
          },
        },
        data: annotationData,
      } as echarts.SeriesOption);
    }

    return {
      animation: false,
      title: {
        text: 'JIT vs. Interpreter · Geometric Mean',
        left: 'center',
        top: isMobile ? 8 : 12,
        textStyle: {
          color: COLORS.title[mode],
          fontFamily: FONT_FAMILY,
          fontSize: isMobile ? 14 : 17,
          fontWeight: 600,
        },
      },
      grid: {
        top: isMobile ? 56 : 68,
        bottom: 36,
        left: isMobile ? 64 : 90,
        right: goalLineEntries.length ? (isMobile ? 80 : 100) : 24,
      },
      xAxis: {
        type: 'time',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: COLORS.grid[mode], type: 'solid' as const },
        },
        axisLabel: {
          color: COLORS.text[mode],
          fontFamily: FONT_FAMILY,
          fontSize: isMobile ? 10 : 11,
          margin: 12,
          formatter: (value: number) => {
            const d = new Date(value);
            return d.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            });
          },
        },
      },
      yAxis: {
        type: 'value',
        name: 'Performance Difference',
        nameLocation: 'middle',
        nameGap: isMobile ? 50 : 64,
        nameTextStyle: {
          color: COLORS.title[mode],
          fontFamily: FONT_FAMILY,
          fontSize: isMobile ? 11 : 12,
          fontWeight: 500,
        },
        min: yRange.min,
        max: yRange.max,
        interval: yRange.interval,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: { color: COLORS.grid[mode], type: 'solid' as const },
        },
        axisLabel: {
          color: COLORS.text[mode],
          fontFamily: FONT_FAMILY,
          fontSize: isMobile ? 10 : 11,
          margin: 12,
          formatter: (value: number) => {
            const sign = value > 0 ? '+' : '';
            if (!isMobile && value === yRange.min) return `${value}% (faster)`;
            if (!isMobile && value === yRange.max) return `+${value}% (slower)`;
            if (value === 0) return '0%';
            return `${sign}${value}%`;
          },
        },
      },
      // Default tooltip: axis-triggered, unified across machines.
      // Annotation series overrides this with its own item-triggered tooltip.
      tooltip: {
        trigger: 'axis',
        enterable: true,
        hideDelay: 300,
        axisPointer: {
          type: 'line',
          snap: true,
          lineStyle: { color: '#8b5cf6', opacity: 0.4 },
        },
        backgroundColor: COLORS.hoverBg[mode],
        borderColor: COLORS.hoverBorder[mode],
        textStyle: {
          color: mode === 'dark' ? '#fafafa' : '#18181b',
          fontFamily: FONT_FAMILY,
          fontSize: 12,
        },
        extraCssText:
          'box-shadow: 0 4px 12px rgba(0,0,0,0.2); pointer-events: auto;',
        formatter: (params: unknown) => {
          // params is array (axis trigger). Filter out the annotation series.
          const arr = params as Array<{
            seriesName: string;
            data: {
              value: [string, number];
              speedup?: number;
              dateStr: string;
            };
            color: string;
            axisValueLabel: string;
          }>;
          const machineRows = arr.filter(
            (p) => p.seriesName !== '__annotations__',
          );
          if (machineRows.length === 0) return '';
          // axisValueLabel includes "00:00:00" — re-format from the raw
          // dateStr stored on each point so the header is just the date.
          const dateStr = machineRows[0].data.dateStr;
          const headerDate = (() => {
            const [y, m, d] = dateStr.split('-').map(Number);
            if (!y || !m || !d) return dateStr;
            return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
              undefined,
              {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              },
            );
          })();
          // Wrap whole tooltip body in an <a> so clicking anywhere inside
          // the tooltip navigates to /run/<date>. pointer-events: auto on
          // the wrapper picks up the click.
          let html =
            `<a href="/run/${dateStr}" style="display:block;text-decoration:none;color:inherit;cursor:pointer">` +
            `<div style="font-weight:600;margin-bottom:4px">${headerDate}</div>`;
          for (const p of machineRows) {
            html +=
              `<div style="display:flex;align-items:center;gap:6px;font-size:12px">` +
              `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color}"></span>` +
              `<span>${p.seriesName}: ${speedupLabel(p.data.speedup)}</span>` +
              `</div>`;
          }
          html +=
            `<div style="font-size:11px;color:${COLORS.hintText};margin-top:4px">Click to view details</div>` +
            `</a>`;
          return html;
        },
      },
      series,
    };
  };

  const renderChart = () => {
    if (!chartDiv) return;
    if (!chart) {
      chart = echarts.init(chartDiv, undefined, { renderer: 'canvas' });

      // Single click handler over the whole plot area. Snaps to the same
      // date column the axisPointer crosshair is showing, then navigates.
      const zr = chart.getZr();

      // Pointer cursor inside the grid (where the crosshair / click lands),
      // default cursor outside (axis labels, title, padding). ECharts sets
      // its own cursor on the inner canvas for hover targets, which beats
      // the parent div's CSS — so we drive the canvas's cursor directly.
      zr.on(
        'mousemove',
        (e: { offsetX: number; offsetY: number; target?: unknown }) => {
          if (!chart || !chartDiv) return;
          const inGrid = chart.containPixel('grid', [e.offsetX, e.offsetY]);
          // Stay as pointer when hovering ANY echarts graphic (annotation
          // pins extend slightly above the grid edge, so containPixel
          // alone misses the upper half of the pin).
          const cursor = inGrid || e.target ? 'pointer' : 'default';
          const canvas = chartDiv.querySelector(
            'canvas',
          ) as HTMLCanvasElement | null;
          if (canvas) canvas.style.cursor = cursor;
          chartDiv.style.cursor = cursor;
        },
      );

      zr.on('click', (e: { offsetX: number; offsetY: number }) => {
        if (!chart) return;
        const inGrid = chart.containPixel('grid', [e.offsetX, e.offsetY]);
        if (!inGrid) return;
        const value = chart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX);
        if (typeof value !== 'number' || Number.isNaN(value)) return;
        const dateStr = new Date(value).toISOString().split('T')[0];
        // Snap to the nearest available date in any machine's data.
        const allDates = new Set<string>();
        for (const r of parsedJitRuns()) allDates.add(r.dateStr);
        const sorted = Array.from(allDates).sort();
        if (sorted.length === 0) return;
        let nearest = sorted[0];
        let bestDiff = Math.abs(
          new Date(nearest).getTime() - new Date(dateStr).getTime(),
        );
        for (const d of sorted) {
          const diff = Math.abs(
            new Date(d).getTime() - new Date(dateStr).getTime(),
          );
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = d;
          }
        }
        props.onPointClick(nearest);
      });
    }
    chart.setOption(buildOption(), true);
  };

  // Resize on window resize
  const handleResize = () => chart?.resize();

  createEffect(
    on(
      [
        () => props.data,
        theme,
        () => props.goalLines,
        machines,
        () => props.showEvents,
        perfEvents,
      ],
      () => {
        if (!chartDiv || !machines()) return;
        renderChart();
      },
    ),
  );

  // Window-resize handling
  createEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', handleResize);
    onCleanup(() => window.removeEventListener('resize', handleResize));
  });

  onCleanup(() => {
    chart?.dispose();
    chart = undefined;
  });

  // Reference for unused warning suppression — annotationTooltipRef is kept
  // for future use but not needed with ECharts native tooltip.
  void annotationTooltipRef;

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
                type="button"
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
            onClick={() =>
              props.onGoalLinesChange((prev) => ({
                ...prev,
                show5: !prev.show5,
              }))
            }
            disabled={props.isLoading}
            title="5% faster (3.15 goal)"
          >
            <span
              class="goal-line-indicator"
              style={{ background: GOAL_LINE_COLORS[5] }}
            />
            5% (3.15)
          </button>
          <button
            type="button"
            class={`goal-line-btn ${props.goalLines.show10 ? 'active' : ''}`}
            onClick={() =>
              props.onGoalLinesChange((prev) => ({
                ...prev,
                show10: !prev.show10,
              }))
            }
            disabled={props.isLoading}
            title="10% faster (3.16 goal)"
          >
            <span
              class="goal-line-indicator"
              style={{ background: GOAL_LINE_COLORS[10] }}
            />
            10% (3.16)
          </button>
          <CustomGoalInput
            goalLines={props.goalLines}
            onGoalLinesChange={props.onGoalLinesChange}
            disabled={props.isLoading}
            color={GOAL_LINE_COLORS.custom}
          />
        </div>
        <span class="controls-divider">|</span>
        <button
          type="button"
          class={`goal-line-btn ${props.showEvents ? 'active' : ''}`}
          onClick={() => props.onShowEventsChange((v) => !v)}
          disabled={props.isLoading}
          title={
            props.showEvents
              ? 'Hide annotations on the chart timeline'
              : 'Show annotations on the chart timeline'
          }
          aria-pressed={props.showEvents}
        >
          <Show
            when={props.showEvents}
            fallback={
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            }
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Show>
          Annotations
        </button>
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
            <div class="legend-item" tabindex="0">
              <span class="legend-color" style={{ background: info.color }} />
              <span class="legend-label">{machine}</span>
              <div class="legend-tooltip" role="tooltip">
                <div class="legend-tooltip-title">{machine}</div>
                <div class="legend-tooltip-row">{info.description}</div>
                <div class="legend-tooltip-row">
                  <span class="legend-tooltip-key">OS:</span> {info.os}
                </div>
                <div class="legend-tooltip-row">
                  <span class="legend-tooltip-key">Arch:</span> {info.arch}
                </div>
              </div>
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
