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

    // Fixed chart title
    const chartTitle = 'JIT Performance Compared to Interpreter (Geometric Mean)';

    // Get most recent date for subtitle
    const mostRecentDate = jitRuns.length > 0
      ? new Date(jitRuns[jitRuns.length - 1].date).toISOString().split('T')[0]
      : null;

    // Variable to track hover state
    let isHoveringSubtitle = false;

    // Custom plugin to handle subtitle clicks, hover, and rendering
    const clickableSubtitlePlugin = {
      id: 'clickableSubtitle',
      afterEvent(chart: Chart, args: { event: ChartEvent }) {
        const event = args.event;
        if (!mostRecentDate) return;

        const chartArea = chart.chartArea;
        const subtitleY = chartArea.top - 15; // Approximate subtitle position
        const subtitleHeight = 20;

        // Check if click is in subtitle area
        if (event.type === 'click' && event.x && event.y) {
          const clickY = event.y;

          if (clickY >= subtitleY - subtitleHeight && clickY <= subtitleY) {
            // Navigate to the most recent run
            window.location.href = `/run/${mostRecentDate}`;
          }
        }

        // Handle cursor change and hover state on mousemove
        if (event.type === 'mousemove' && event.x && event.y) {
          const hoverY = event.y;
          const wasHovering = isHoveringSubtitle;

          if (hoverY >= subtitleY - subtitleHeight && hoverY <= subtitleY) {
            isHoveringSubtitle = true;
            chart.canvas.style.cursor = 'pointer';
          } else {
            isHoveringSubtitle = false;
            // Only reset cursor if not over a data point
            const activeElements = chart.getActiveElements();
            if (activeElements.length === 0) {
              chart.canvas.style.cursor = 'default';
            }
          }

          // Trigger redraw if hover state changed
          if (wasHovering !== isHoveringSubtitle) {
            chart.update('none');
          }
        }
      },
      afterDraw(chart: Chart) {
        if (!mostRecentDate) return;

        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const subtitleText = `View most recent run (${mostRecentDate}) →`;

        // Set font
        ctx.font = `normal 12px -apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif`;

        // Set color with opacity
        const baseColor = isDark ? 'rgba(196, 181, 253, 0.7)' : 'rgba(109, 40, 217, 0.7)';
        ctx.fillStyle = baseColor;

        // Calculate text position (centered)
        const textWidth = ctx.measureText(subtitleText).width;
        const x = (chart.width - textWidth) / 2;
        const y = chartArea.top - 15;

        // Draw text
        ctx.fillText(subtitleText, x, y);

        // Draw underline on hover
        if (isHoveringSubtitle) {
          ctx.beginPath();
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = 1;
          ctx.moveTo(x, y + 2);
          ctx.lineTo(x + textWidth, y + 2);
          ctx.stroke();
        }
      }
    };

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'JIT Performance (Geometric Mean)',
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
            padding: { top: 10, bottom: 30 }  // Extra bottom padding for custom subtitle
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
                let performanceText = '';
                if (speedup > 1.0) {
                  // JIT is faster
                  const percentFaster = ((speedup - 1) * 100).toFixed(1);
                  performanceText = `${percentFaster}% faster`;
                } else if (speedup < 1.0) {
                  // JIT is slower
                  const percentSlower = ((1 - speedup) * 100).toFixed(1);
                  performanceText = `${percentSlower}% slower`;
                } else {
                  performanceText = 'same speed';
                }
                return [
                  ` JIT (geometric mean): ${performanceText}`,
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
            min: 0.85,
            max: 1.15,
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
                  const percentSlower = ((v - 1) * 100).toFixed(0);
                  return `-${percentSlower}%`;
                } else {
                  const percentFaster = ((1 - v) * 100).toFixed(0);
                  return `+${percentFaster}%`;
                }
              },
            },
          },
        },
      },
      plugins: [clickableSubtitlePlugin],
    };

    chartInstance = new Chart(canvasRef, config);
  };

  onMount(() => {
    createChart();
  });

  createEffect(() => {
    // Track props.data and theme() to properly react to changes
    // Accessing these reactive values registers them as dependencies
    props.data;
    theme();

    // Only destroy and recreate if chart already exists
    if (chartInstance) {
      chartInstance.destroy();
      createChart();
    }
  });

  onCleanup(() => {
    if (chartInstance) {
      chartInstance.destroy();
    }
  });

  return (
    <div class="chart-section">
      <div class="chart-container">
        <canvas ref={canvasRef} style={{ cursor: 'pointer' }} />
      </div>
      <p class="chart-subtext">
        <a href="/about">Learn more about these benchmark runs</a>
      </p>
    </div>
  );
};

export default PerformanceChart;
