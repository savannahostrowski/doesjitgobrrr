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
import type { BenchmarkRun, DateRange, GoalLines, PerfEvent } from '../types';
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

const ANNOTATION_COLOR = '#a1a1aa';
const ANNOTATION_DOT_SIZE = 7;

// Cluster annotation pins within this many days when the timeline is dense.
const CLUSTER_DAYS_ALL_TIME = 3;

// Tooltip body max width — capped on small viewports too.
const TOOLTIP_MAX_WIDTH = 340;

/** Parse a YYYY-MM-DD string at UTC midnight. Returns null on invalid input.
 * Strict — out-of-range months/days (e.g. "2026-13-01", "2026-02-30") return
 * null instead of being silently rolled forward by the JS Date constructor. */
function parseUtcDate(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // JS Date silently rolls overflow (Feb 30 → Mar 2). Reject any date that
  // doesn't round-trip the original components.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

/** Format a YYYY-MM-DD as a localized date in UTC, with optional config. */
function formatChartDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  },
): string {
  const d = parseUtcDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/** Format two YYYY-MM-DD strings as a range, eliding the year on the left
 * when both dates fall in the same year ("Apr 11 – Apr 14, 2026"). */
function formatChartDateRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatChartDate(startIso);
  const start = parseUtcDate(startIso);
  const end = parseUtcDate(endIso);
  if (!start || !end) return `${startIso} – ${endIso}`;
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const left = sameYear
    ? formatChartDate(startIso, { month: 'short', day: 'numeric' })
    : formatChartDate(startIso);
  const right = formatChartDate(endIso);
  return `${left} – ${right}`;
}

/** Escape a string for safe use as the value of an HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Strip leading "gh-NNNN: " or "GH-NNNN: " issue references — when many
 * commits target the same issue, the prefix dominates and titles look
 * like duplicates. */
function stripIssuePrefix(title: string): string {
  return title.replace(/^(?:gh|GH)-+\d+:\s*/i, '');
}

/** Render markdown-style `inline code` spans as <code> tags. Other text is
 * HTML-escaped. Safe to inject into HTML. */
function renderInlineCode(text: string): string {
  const parts = text.split('`');
  return parts
    .map((part, i) => {
      const escaped = escapeAttr(part);
      // Odd indices are inside backticks → wrap in <code>.
      return i % 2 === 1
        ? `<code class="change-tooltip-code">${escaped}</code>`
        : escaped;
    })
    .join('');
}

const LINK_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />' +
  '<polyline points="15 3 21 3 21 9" />' +
  '<line x1="10" y1="14" x2="21" y2="3" />' +
  '</svg>';

/** Render a single change row (date prefix optional, ellipsis on overflow). */
function renderChangeRow(e: PerfEvent, showDatePrefix: boolean): string {
  // safeTitle is for the `title=` attribute (plain text); display goes
  // into HTML and gets backtick → <code> conversion.
  const safeTitle = escapeAttr(e.title.replace(/`/g, ''));
  const display = renderInlineCode(stripIssuePrefix(e.title));
  const linkIcon = e.link
    ? `<a href="${escapeAttr(e.link)}" target="_blank" rel="noopener noreferrer" ` +
      `style="flex-shrink:0;display:inline-flex;align-items:center;color:#a1a1aa;text-decoration:none" ` +
      `title="Open source in new tab">${LINK_ICON_SVG}</a>`
    : '';
  const datePrefix = showDatePrefix
    ? `<span style="flex-shrink:0;color:#71717a;font-size:11px;font-variant-numeric:tabular-nums;width:42px">` +
      `${escapeAttr(formatChartDate(e.date, { month: 'short', day: 'numeric' }))}` +
      `</span>`
    : '';
  return (
    `<div style="display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.3;padding:2px 0">` +
    datePrefix +
    `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${safeTitle}">${display}</span>` +
    linkIcon +
    `</div>`
  );
}

/** ECharts tooltip formatter for the annotation scatter series. */
function formatChangeTooltip(params: unknown): string {
  const p = params as { data: { group: PerfEvent[] } };
  const group = p.data.group;
  if (!group?.length) return '';
  const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
  const minDate = sorted[0].date;
  const maxDate = sorted[sorted.length - 1].date;
  const showDatePrefix = minDate !== maxDate;
  const formattedDate = formatChartDateRange(minDate, maxDate);
  const header =
    `<div style="color:#a1a1aa;font-size:11px;margin-bottom:4px">` +
    `${formattedDate}${group.length > 1 ? ` · ${group.length} changes` : ''}` +
    `</div>`;
  return (
    `<div style="max-width:${TOOLTIP_MAX_WIDTH}px;width:min(${TOOLTIP_MAX_WIDTH}px, calc(100vw - 32px))">` +
    header +
    sorted.map((e) => renderChangeRow(e, showDatePrefix)).join('') +
    `</div>`
  );
}

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

    // Annotation series. Two treatments to keep the timeline readable:
    //   (1) cluster nearby dates at all-time zoom so dots don't overlap
    //   (2) muted opacity by default, full opacity on hover
    const clusterDays = props.dateRange === 'all' ? CLUSTER_DAYS_ALL_TIME : 0;

    type Cluster = { date: string; events: PerfEvent[] };
    const inRange = events
      .filter((e) => {
        const t = parseUtcDate(e.date)?.getTime();
        return t !== undefined && t >= minDate && t <= maxDate;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const clusters: Cluster[] = [];
    for (const e of inRange) {
      const last = clusters[clusters.length - 1];
      if (last) {
        const lastTime = parseUtcDate(last.date)?.getTime() ?? 0;
        const eTime = parseUtcDate(e.date)?.getTime() ?? 0;
        if ((eTime - lastTime) / 86400000 <= clusterDays) {
          last.events.push(e);
          continue;
        }
      }
      clusters.push({ date: e.date, events: [e] });
    }

    const annotationData = clusters.map((c) => ({
      value: [c.date, yRange.max],
      group: c.events,
      itemStyle: { color: ANNOTATION_COLOR, opacity: 0.85 },
    }));

    if (annotationData.length > 0) {
      series.push({
        type: 'scatter',
        name: '__annotations__',
        // Small filled circle at the top edge of the chart, one per change
        // (or one per cluster of changes within CLUSTER_DAYS_ALL_TIME).
        symbol: 'circle',
        symbolSize: ANNOTATION_DOT_SIZE,
        symbolOffset: [0, '-50%'],
        z: 10,
        emphasis: {
          itemStyle: { opacity: 1, color: ANNOTATION_COLOR },
          scale: 1.4,
        },
        // Per-series tooltip with item trigger so it only shows when the
        // cursor is exactly on the marker.
        tooltip: {
          trigger: 'item',
          // Allow taps on touch devices to show the tooltip. Without this
          // a tap fires the chart click handler (navigate) without ever
          // showing the change details.
          triggerOn: 'mousemove|click',
          formatter: (params: unknown) => formatChangeTooltip(params),
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
            const [tw, th] = size.contentSize;
            const containerWidth = chart?.getWidth() ?? window.innerWidth;
            const containerHeight = chart?.getHeight() ?? window.innerHeight;
            const margin = 8;
            // Center on marker, then clamp inside the chart container so the
            // tooltip never bleeds off the screen on narrow viewports.
            let x = rect.x + rect.width / 2 - tw / 2;
            if (x < margin) x = margin;
            if (x + tw > containerWidth - margin) {
              x = containerWidth - margin - tw;
            }
            // Below marker normally; flip above if it would overflow bottom.
            let y = rect.y + rect.height - 4;
            if (y + th > containerHeight - margin) {
              y = rect.y - th - 4;
              if (y < margin) y = margin;
            }
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
        // Tap-to-show on mobile (otherwise touch users only get the chart
        // click handler firing without ever seeing tooltip content).
        triggerOn: 'mousemove|click',
        // Keep tooltip inside the chart bounds — important on mobile.
        confine: true,
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
          const headerDate = formatChartDate(dateStr);
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

      zr.on(
        'click',
        (e: { offsetX: number; offsetY: number; target?: unknown }) => {
          if (!chart) return;
          const inGrid = chart.containPixel('grid', [e.offsetX, e.offsetY]);
          if (!inGrid) return;
          // If the user clicked an annotation marker (or its tooltip
          // anchor), let the per-series tooltip take over and skip the
          // chart-wide navigate. Important on touch where tap = both
          // tooltip + click.
          const t = e.target as
            | { __ecComponentInfo?: { mainType?: string } }
            | undefined;
          if (t?.__ecComponentInfo?.mainType === 'series') {
            // Could be a line-series point or annotation marker. Inspect
            // the dataIndex/seriesIndex via dispatched action if needed.
            // Simpler heuristic: if the cursor is near an annotation date
            // (within marker hit-radius), skip navigation.
            const cursorTime = chart.convertFromPixel(
              { xAxisIndex: 0 },
              e.offsetX,
            );
            // Only consider markers when the user actually has them on —
            // otherwise we'd silently swallow clicks near event dates even
            // though no marker is visible to click.
            if (
              props.showEvents &&
              typeof cursorTime === 'number' &&
              perfEvents()
            ) {
              const HIT_PX = ANNOTATION_DOT_SIZE;
              for (const ev of perfEvents() ?? []) {
                const evTime = parseUtcDate(ev.date)?.getTime();
                if (evTime === undefined) continue;
                const evX = chart.convertToPixel({ xAxisIndex: 0 }, evTime);
                if (
                  typeof evX === 'number' &&
                  Math.abs(evX - e.offsetX) <= HIT_PX
                ) {
                  return; // tooltip handles it
                }
              }
            }
          }

          const value = chart.convertFromPixel({ xAxisIndex: 0 }, e.offsetX);
          if (typeof value !== 'number' || Number.isNaN(value)) return;
          // Snap to the nearest available date in any machine's data.
          const target = value;
          let nearest = '';
          let bestDiff = Number.POSITIVE_INFINITY;
          const seen = new Set<string>();
          for (const r of parsedJitRuns()) {
            if (seen.has(r.dateStr)) continue;
            seen.add(r.dateStr);
            const diff = Math.abs(
              (parseUtcDate(r.dateStr)?.getTime() ?? 0) - target,
            );
            if (diff < bestDiff) {
              bestDiff = diff;
              nearest = r.dateStr;
            }
          }
          if (nearest) props.onPointClick(nearest);
        },
      );
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
        <div class="annotations-toggle-group">
          <button
            type="button"
            class={`goal-line-btn ${props.showEvents ? 'active' : ''}`}
            onClick={() => props.onShowEventsChange((v) => !v)}
            disabled={props.isLoading}
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
            Changes
          </button>
          <span
            class="annotations-info"
            tabindex="0"
            role="img"
            aria-label="About change dates"
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div class="annotations-info-tooltip" role="tooltip">
              <div class="annotations-info-title">About change dates</div>
              <div class="annotations-info-body">
                Each marker shows the day a JIT-relevant CPython PR merged.
                Benchmarks pick up each day's commit at{' '}
                <strong>11 PM UTC</strong>, so a change merged later may only
                appear in the following night's run.
              </div>
            </div>
          </span>
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
      {/* Screen-reader / keyboard fallback for change markers — the canvas
          itself isn't navigable. Visually hidden by default, exposed when
          focused so keyboard users can find it. */}
      <Show when={props.showEvents && (perfEvents() ?? []).length > 0}>
        <details class="changes-sr-list">
          <summary>View all changes ({(perfEvents() ?? []).length})</summary>
          <ul>
            <For each={perfEvents() ?? []}>
              {(e) => (
                <li>
                  <time datetime={e.date}>{formatChartDate(e.date)}</time>
                  {' — '}
                  {e.link ? (
                    <a href={e.link} target="_blank" rel="noopener noreferrer">
                      {stripIssuePrefix(e.title)}
                    </a>
                  ) : (
                    stripIssuePrefix(e.title)
                  )}
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
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
