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
import { getArchitecture } from '../utils';

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

    // Group JIT runs by machine, taking only the latest run per day
    const jitRunsByMachine = new Map<string, typeof props.data>();
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

        // Keep the run with the latest created_at timestamp for this date
        if (!existing || new Date(run.created_at) > new Date(existing.created_at)) {
          runsByDate.set(dateStr, run);
        }
      });

      // Convert back to array and sort chronologically
      const deduplicated = Array.from(runsByDate.values())
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      jitRunsByMachine.set(machine, deduplicated);
    });

    // Fixed chart title - use array for multi-line on mobile
    const chartTitle = [
      'JIT vs. Interpreter Benchmark Execution Time',
      '(Geometric Mean)'
    ];

    // Get most recent date for subtitle (from any machine)
    let mostRecentDate: string | null = null;
    jitRunsByMachine.forEach(runs => {
      if (runs.length > 0) {
        const lastRun = runs[runs.length - 1];
        const lastDate = new Date(lastRun.date);
        if (!mostRecentDate || lastDate > new Date(mostRecentDate)) {
          mostRecentDate = lastDate.toISOString().split('T')[0];
        }
      }
    });

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

        // Set color based on hover state
        const baseColor = isDark ? 'rgba(196, 181, 253, 0.7)' : 'rgba(109, 40, 217, 0.7)';
        const hoverColor = isDark ? 'rgba(196, 181, 253, 1.0)' : 'rgba(109, 40, 217, 1.0)';
        ctx.fillStyle = isHoveringSubtitle ? hoverColor : baseColor;

        // Calculate text position (centered)
        const textWidth = ctx.measureText(subtitleText).width;
        const x = (chart.width - textWidth) / 2;
        const y = chartArea.top - 15;

        // Draw text
        ctx.fillText(subtitleText, x, y);
      }
    };

    // Machine colors (expand as needed)
    const machineColors: Record<string, { border: string; background: string }> = {
      'blueberry': { border: '#a855f7', background: 'rgba(168, 85, 247, 0.15)' },  // purple
      'ripley': { border: '#3b82f6', background: 'rgba(59, 130, 246, 0.15)' },     // blue
      'unknown': { border: '#6b7280', background: 'rgba(107, 114, 128, 0.15)' },   // gray
    };

    // Plugin to draw static connector lines between same-date points
    const dateConnectorPlugin = {
      id: 'dateConnector',
      beforeDatasetsDraw(chart: Chart) {
        const ctx = chart.ctx;
        const datasets = chart.data.datasets;

        if (datasets.length < 2) return;

        // Group points by timestamp (date) with full run data
        const pointsByTimestamp = new Map<number, Array<{x: number, y: number, run: BenchmarkRun}>>();

        datasets.forEach((dataset) => {
          const data = dataset.data as Array<{x: number, y: number, run: BenchmarkRun}>;
          data.forEach((point) => {
            const timestamp = point.x;
            if (!pointsByTimestamp.has(timestamp)) {
              pointsByTimestamp.set(timestamp, []);
            }
            pointsByTimestamp.get(timestamp)!.push({
              x: chart.scales.x.getPixelForValue(timestamp),
              y: chart.scales.y.getPixelForValue(point.y),
              run: point.run
            });
          });
        });

        // Draw connector lines for dates with multiple machines
        ctx.save();

        pointsByTimestamp.forEach(points => {
          if (points.length > 1) {
            // Sort by y coordinate
            points.sort((a, b) => a.y - b.y);

            // Draw thicker background line for emphasis
            ctx.strokeStyle = isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(124, 58, 237, 0.25)';
            ctx.lineWidth = 3;
            ctx.setLineDash([]);

            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
            ctx.stroke();

            // Draw small circles at connection points for clarity
            ctx.fillStyle = isDark ? 'rgba(139, 92, 246, 0.2)' : 'rgba(124, 58, 237, 0.15)';
            points.forEach(point => {
              ctx.beginPath();
              ctx.arc(point.x, point.y, 12, 0, 2 * Math.PI);
              ctx.fill();
            });
          }
        });

        ctx.restore();
      }
    };

    // Create datasets for each machine
    const datasets = Array.from(jitRunsByMachine.entries()).map(([machine, runs]) => {
      const colors = machineColors[machine] || machineColors['unknown'];
      return {
        label: `${machine} (${getArchitecture(machine)})`,
        data: runs.map(r => ({
          x: new Date(r.date).getTime(),
          y: 2.0 - (r.speedup || 1.0), // Invert so slower (0.918) plots higher
          run: r, // Store the run for click handling
        })),
        borderColor: colors.border,
        backgroundColor: colors.background,
        pointBackgroundColor: colors.border,
        pointBorderColor: 'transparent',
        pointBorderWidth: 0,
        pointRadius: 7,
        pointHoverRadius: 10,
        pointHoverBorderWidth: 0,
        pointStyle: 'circle',
        borderWidth: 4,
        tension: 0.4,
      };
    });

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'x',
          intersect: false,
        },
        onHover: (_event: ChartEvent, activeElements: ActiveElement[], chart: Chart) => {
          chart.canvas.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
        },
        onClick: (_event: ChartEvent, activeElements: ActiveElement[], chart: Chart) => {
          if (activeElements.length > 0) {
            const datasetIndex = activeElements[0].datasetIndex;
            const index = activeElements[0].index;
            const dataset = chart.data.datasets[datasetIndex];
            const data = dataset.data as Array<{x: number, y: number, run: BenchmarkRun}>;
            const clickedRun = data[index].run;
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
            display: true,
            position: 'bottom',
            align: 'center',
            labels: {
              color: textColor,
              font: {
                size: 12,
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              },
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 15,
            }
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
                // Get the actual speedup from the stored run data
                const datasetData = context.dataset.data as Array<{x: number, y: number, run: BenchmarkRun}>;
                const dataPoint = datasetData[context.dataIndex];
                if (!dataPoint || !dataPoint.run) {
                  return '';
                }
                const speedup = dataPoint.run.speedup || 1.0;
                const machine = context.dataset.label?.split(' ')[0] || 'unknown';

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
                return ` ${machine}: ${performanceText}`;
              },
              footer: (items) => {
                if (items.length > 0) {
                  return 'Click to view details';
                }
                return '';
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
            border: {
              display: false,
            },
            grid: {
              color: gridColor,
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
              text: 'Performance Difference',
              color: titleColor,
              font: {
                size: 14,
                weight: 'bold',
                family: "-apple-system, BlinkMacSystemFont, segoe ui, Roboto, Oxygen, Ubuntu, Cantarell, open sans, helvetica neue, sans-serif"
              }
            },
            border: {
              display: false,
            },
            grid: {
              color: gridColor,
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
                let label = '';
                if (v >= 1.0) {
                  const percentSlower = ((v - 1) * 100).toFixed(0);
                  label = `+${percentSlower}%`;
                  // Add "slower" label at the bottom (after reverse)
                  if (v === 1.15) {
                    label += ' (slower)';
                  }
                } else {
                  const percentFaster = ((1 - v) * 100).toFixed(0);
                  label = `-${percentFaster}%`;
                  // Add "faster" label at the top (after reverse)
                  if (v === 0.85) {
                    label += ' (faster)';
                  }
                }
                return label;
              },
            },
          },
        },
      },
      plugins: [dateConnectorPlugin, clickableSubtitlePlugin],
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
        <canvas ref={canvasRef} style={{ cursor: "pointer" }} />
      </div>
      <p class="chart-subtext">
        <a href="/about">Learn more about these benchmark runs</a>
      </p>
    </div>
  );
};

export default PerformanceChart;
