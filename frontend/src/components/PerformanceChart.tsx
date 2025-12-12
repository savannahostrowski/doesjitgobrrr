import { type Component, type Setter, onMount, onCleanup, createEffect, createMemo, For } from 'solid-js';

// Plotly is loaded via CDN in index.html
declare const Plotly: any;
import type { BenchmarkRun } from '../types';
import { useTheme } from '../ThemeContext';
import { getArchitecture } from '../utils';

type DateRange = 7 | 30 | 'all';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

interface PerformanceChartProps {
  data: BenchmarkRun[];
  onPointClick: (dateStr: string) => void;
  dateRange: DateRange;
  onDateRangeChange: Setter<DateRange>;
  isLoading?: boolean;
}

const PerformanceChart: Component<PerformanceChartProps> = (props) => {
  let chartDiv: HTMLDivElement | undefined;
  const { theme } = useTheme();

  // Compute most recent date from JIT runs
  const mostRecentDate = createMemo(() => {
    const jitRuns = props.data.filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined);
    if (jitRuns.length === 0) return null;
    const sorted = [...jitRuns].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return new Date(sorted[0].date).toISOString().split('T')[0];
  });

  // Machine colors
  const machineColors: Record<string, string> = {
    'blueberry': '#a855f7',  // purple
    'ripley': '#3b82f6',     // blue
    'jones': '#10b981',      // green
    'unknown': '#6b7280',    // gray
  };

  const createChart = () => {
    if (!chartDiv) return;

    const isDark = theme() === 'dark';

    // Theme-aware colors
    const textColor = isDark ? '#e5e7eb' : '#1a1a1a';
    const titleColor = isDark ? '#c4b5fd' : '#6d28d9';
    const gridColor = isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(124, 58, 237, 0.2)';
    const paperBgColor = 'rgba(0,0,0,0)'; // Transparent to show CSS background

    // Group JIT runs by machine, taking only the latest run per day
    const jitRunsByMachine = new Map<string, BenchmarkRun[]>();
    props.data
      .filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .forEach(run => {
        const machine = run.machine || 'unknown';
        if (!jitRunsByMachine.has(machine)) {
          jitRunsByMachine.set(machine, []);
        }
        jitRunsByMachine.get(machine)!.push(run);
      });

    // Deduplicate by date - keep only the latest run per day for each machine
    jitRunsByMachine.forEach((runs, machine) => {
      const runsByDate = new Map<string, BenchmarkRun>();

      runs.forEach(run => {
        const dateStr = new Date(run.date).toISOString().split('T')[0];
        const existing = runsByDate.get(dateStr);

        if (!existing || (run.directory_name || '') > (existing.directory_name || '')) {
          runsByDate.set(dateStr, run);
        }
      });

      const deduplicated = Array.from(runsByDate.values())
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      jitRunsByMachine.set(machine, deduplicated);
    });


    // Create traces for Plotly (sorted by machine name for consistent legend order)
    const sortedMachines = Array.from(jitRunsByMachine.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const traces = sortedMachines.map(([machine, runs]) => {
      const color = machineColors[machine] || machineColors['unknown'];

      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: `${machine} (${getArchitecture(machine)})`,
        x: runs.map(r => new Date(r.date)),
        y: runs.map(r => {
          // Convert speedup to percentage difference (negated so faster is down, slower is up)
          const speedup = r.speedup || 1.0;
          return (1 - speedup) * 100; // e.g., 1.02 -> -2% (faster, down), 0.95 -> +5% (slower, up)
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
        customdata: runs.map(r => new Date(r.date).toISOString().split('T')[0]),
        hovertemplate: `${machine}: %{text}<extra></extra>`,
        line: {
          color: color,
          width: 3,
          shape: 'spline',
          smoothing: 0.8,
        },
        marker: {
          color: color,
          size: 10,
          line: {
            color: isDark ? '#1a1a1a' : '#ffffff',
            width: 2,
          },
        },
      };
    });

    // Add an invisible trace for "Click to view details" text in unified hover
    // Get all unique dates from the data
    const allDates = new Set<string>();
    jitRunsByMachine.forEach(runs => {
      runs.forEach(r => allDates.add(new Date(r.date).toISOString()));
    });
    const sortedDates = Array.from(allDates).sort();

    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: '',
      x: sortedDates.map(d => new Date(d)),
      y: sortedDates.map(() => 0), // Plot at y=0 (zero line)
      marker: { size: 0, color: 'transparent', line: { color: 'transparent', width: 0 } },
      customdata: sortedDates.map(d => new Date(d).toISOString().split('T')[0]),
      hovertemplate: '<span style="font-size:11px;color:#9ca3af">Click to view details</span><extra></extra>',
      showlegend: false,
    } as any);

    // Responsive sizing
    const isMobile = window.innerWidth < 768;
    const titleSize = isMobile ? 14 : 18;
    const yAxisTitleSize = isMobile ? 11 : 14;
    const tickFontSize = isMobile ? 10 : 12;
    const leftMargin = isMobile ? 70 : 100;

    const layout = {
      title: {
        text: '<b>JIT vs. Interpreter Benchmark Execution Time</b><br><sub>(Geometric Mean)</sub>',
        font: {
          family: '-apple-system, BlinkMacSystemFont, segoe ui, Roboto, sans-serif',
          size: titleSize,
          color: titleColor,
        },
        x: 0.5,
        xanchor: 'center',
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
        zerolinecolor: isDark ? 'rgba(139, 92, 246, 0.5)' : 'rgba(124, 58, 237, 0.5)',
        zerolinewidth: 2,
        range: [-20, 20],
        ticksuffix: '%',
        tickvals: [-20, -15, -10, -5, 0, 5, 10, 15, 20],
        ticktext: isMobile
          ? ['+20%', '+15%', '+10%', '+5%', '0%', '-5%', '-10%', '-15%', '+20%']
          : ['+20% faster', '+15%', '+10%', '+5%', '0%', '-5%', '-10%', '-15%', '+20% slower'],
      },
      showlegend: false,
      hovermode: 'x unified',
      hoverlabel: {
        bgcolor: isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        bordercolor: isDark ? '#8b5cf6' : '#7c3aed',
        font: {
          color: textColor,
          family: '-apple-system, BlinkMacSystemFont, segoe ui, Roboto, sans-serif',
          size: 13,
        },
      },
      plot_bgcolor: paperBgColor,
      paper_bgcolor: paperBgColor,
      margin: { t: isMobile ? 60 : 80, r: 10, b: 40, l: leftMargin },
      autosize: true,
      uirevision: 'true', // Preserve UI state (legend visibility, zoom) across updates
    };

    const config = {
      responsive: true,
      displayModeBar: false,
      scrollZoom: false,
    };

    Plotly.newPlot(chartDiv, traces, layout, config).then(() => {
      // Add click handler for points after chart is created
      // @ts-ignore - Plotly adds 'on' method to the div
      chartDiv.on('plotly_click', (data: { points: Array<{ customdata: string; x: string }> }) => {
        if (data.points && data.points.length > 0) {
          // Find first point with valid customdata
          for (const point of data.points) {
            if (point.customdata) {
              props.onPointClick(point.customdata);
              return;
            }
          }
          // Fallback: use x value date
          const point = data.points[0];
          if (point.x) {
            const dateStr = new Date(point.x).toISOString().split('T')[0];
            props.onPointClick(dateStr);
          }
        }
      });
    });
  };

  onMount(() => {
    createChart();
  });

  createEffect(() => {
    // Track reactive dependencies
    props.data;
    theme();

    // Recreate chart when data or theme changes
    if (chartDiv) {
      Plotly.purge(chartDiv);
      createChart();
    }
  });

  onCleanup(() => {
    if (chartDiv) {
      Plotly.purge(chartDiv);
    }
  });

  return (
    <div class="chart-section">
      <div class="chart-controls">
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
        {mostRecentDate() && (
          <a class="view-latest-link" href={`/run/${mostRecentDate()}`}>
            View latest run ({mostRecentDate()}) &rarr;
          </a>
        )}
      </div>
      <div class={`chart-container ${props.isLoading ? 'chart-loading' : ''}`}>
        <div ref={chartDiv} style={{ width: '100%', height: '100%', cursor: 'pointer' }} />
      </div>
      <div class="chart-legend">
        <For each={Object.entries(machineColors).filter(([m]) => m !== 'unknown')}>
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
