import { type Component, onMount, onCleanup, createEffect } from 'solid-js';
import {
  Chart,
  type ChartConfiguration,
  type ChartEvent,
  type ActiveElement,
  registerables,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import type { BenchmarkRun } from '../types';
import { useTheme } from '../ThemeContext';

Chart.register(...registerables);

interface PerformanceChartProps {
  data: BenchmarkRun[];
  onPointClick: (dateStr: string) => void;
}

const PerformanceChart: Component<PerformanceChartProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let chartInstance: Chart | undefined;
  const { theme } = useTheme();

  const createChart = () => {
    if (!canvasRef) return;

    // Detect theme
    const isDark = theme() === 'dark';

    // Theme-aware colors
    const textColor = isDark ? '#e5e7eb' : '#1a1a1a';
    const titleColor = isDark ? '#c4b5fd' : '#6d28d9';
    const gridColor = isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(124, 58, 237, 0.2)';
    const tooltipBg = isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    const tooltipBorder = isDark ? '#8b5cf6' : '#7c3aed';

    // Filter JIT runs with speedup data, reverse for chronological order
    const jitRuns = props.data
      .filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .reverse();

    // Get latest speedup for dynamic title
    const latestSpeedup = jitRuns.length > 0 ? jitRuns[jitRuns.length - 1].speedup : null;
    let chartTitle = 'JIT Performance Over Time';

    if (latestSpeedup !== null && latestSpeedup !== undefined) {
      const percentChange = Math.abs((latestSpeedup - 1) * 100);
      if (latestSpeedup > 1.0) {
        chartTitle = `JIT went brrr! It was ${percentChange.toFixed(1)}% faster`;
      } else if (latestSpeedup < 1.0) {
        chartTitle = `JIT did not go brrr! It was ${percentChange.toFixed(1)}% slower`;
      } else {
        chartTitle = 'JIT went brrr! It was the same';
      }
    }

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'JIT Speedup',
            data: jitRuns.map(r => ({
              x: new Date(r.date).getTime(),
              y: r.speedup || 1.0,
            })),
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168, 85, 247, 0.15)',
            pointBackgroundColor: '#a855f7',
            pointBorderColor: 'transparent',
            pointBorderWidth: 0,
            pointRadius: 7,
            pointHoverRadius: 10,
            pointHoverBorderWidth: 0,
            pointStyle: 'circle',
            borderWidth: 4,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'nearest',
          intersect: true,
        },
        onClick: (_event: ChartEvent, activeElements: ActiveElement[]) => {
          if (activeElements.length > 0) {
            const index = activeElements[0].index;
            const clickedRun = jitRuns[index];
            const clickedDate = new Date(clickedRun.date).toISOString().split('T')[0];
            props.onPointClick(clickedDate);
          }
        },
        plugins: {
          title: {
            display: true,
            text: chartTitle,
            font: {
              size: 18,
              weight: 'bold',
              family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
            },
            color: titleColor,
            padding: { top: 10, bottom: 20 }
          },
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: titleColor,
            bodyColor: textColor,
            borderColor: tooltipBorder,
            borderWidth: 2,
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            titleFont: {
              size: 14,
              weight: 'bold',
              family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
            },
            bodyFont: {
              size: 13,
              family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
            },
            callbacks: {
              title: (items) => {
                const xValue = items[0].parsed.x;
                if (xValue === null) return '';
                const date = new Date(xValue);
                return date.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                });
              },
              label: (context) => {
                const speedup = context.parsed.y ?? 1.0;
                let speedupText = '';
                if (speedup >= 1.0) {
                  const percentFaster = ((speedup - 1) * 100).toFixed(1);
                  speedupText = `${percentFaster}% faster`;
                } else {
                  const percentSlower = ((1 - speedup) * 100).toFixed(1);
                  speedupText = `${percentSlower}% slower`;
                }
                return [
                  ` JIT: ${speedupText}`,
                  ' Click to view details',
                ];
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'day',
              tooltipFormat: 'MMM d, yyyy',
              displayFormats: {
                day: 'MMM d',
              },
            },
            title: {
              display: true,
              text: 'Date',
              color: titleColor,
              font: {
                size: 14,
                weight: 'bold',
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              }
            },
            grid: {
              color: gridColor,
              drawBorder: false,
            },
            ticks: {
              color: textColor,
              font: {
                size: 12,
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              }
            }
          },
          y: {
            type: 'linear',
            min: 0.95,  // -5%
            max: 1.05,  // +5%
            title: {
              display: true,
              text: 'Performance Change',
              color: titleColor,
              font: {
                size: 14,
                weight: 'bold',
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              }
            },
            grid: {
              color: gridColor,
              drawBorder: false,
            },
            ticks: {
              color: textColor,
              font: {
                size: 12,
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              },
              maxTicksLimit: 8,
              callback: (value) => {
                const v = value as number;
                if (v >= 1.0) {
                  const percentFaster = ((v - 1) * 100).toFixed(0);
                  return `+${percentFaster}%`;
                } else {
                  const percentSlower = ((1 - v) * 100).toFixed(0);
                  return `-${percentSlower}%`;
                }
              },
            },
          },
        },
      },
    };

    chartInstance = new Chart(canvasRef, config);
  };

  onMount(() => {
    createChart();
  });

  createEffect(() => {
    // React to data or theme changes
    if (chartInstance && (props.data || theme())) {
      chartInstance.destroy();
      createChart();
    }
  });

  onCleanup(() => {
    if (chartInstance) {
      chartInstance.destroy();
    }
  });

  // Get the most recent date for the link
  const getMostRecentDate = () => {
    const jitRuns = props.data
      .filter(r => r.is_jit && r.speedup !== null && r.speedup !== undefined)
      .reverse();

    if (jitRuns.length > 0) {
      const latestRun = jitRuns[jitRuns.length - 1];
      return new Date(latestRun.date).toISOString().split('T')[0];
    }
    return null;
  };

  const mostRecentDate = getMostRecentDate();

  return (
    <div class="chart-section">
      <div class="chart-container">
        <canvas ref={canvasRef} style={{ cursor: 'pointer' }} />
        {mostRecentDate && (
          <div style={{
            'text-align': 'center',
            'margin-top': '1rem',
            'font-size': '0.9rem',
            'opacity': '0.8'
          }}>
            <a
              href={`/run/${mostRecentDate}`}
              style={{
                'color': 'var(--accent-tertiary)',
                'text-decoration': 'none',
                'font-weight': '600'
              }}
              onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
              onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
            >
              View most recent run →
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceChart;
