// Configuration
const API_URL = 'http://localhost:8000';

// State
let historicalData = [];
let chart = null;
let currentSort = { column: 'name', direction: 'asc' };

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const chartViewEl = document.getElementById('chart-view');
const detailViewEl = document.getElementById('detail-view');
const headerTitle = document.getElementById('header-title');
const headerSubtitle = document.getElementById('header-subtitle');
const backButton = document.getElementById('back-button');
const runDateEl = document.getElementById('run-date');
const pythonVersionEl = document.getElementById('python-version');
const commitHashEl = document.getElementById('commit-hash');
const totalBenchmarksEl = document.getElementById('total-benchmarks');
const searchInput = document.getElementById('search');
const benchmarkTable = document.getElementById('benchmark-table');
const benchmarkTbody = document.getElementById('benchmark-tbody');

// Format time value to appropriate unit
function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return '-';

    if (seconds < 0.000001) {
        return (seconds * 1000000000).toFixed(3) + ' ns';
    } else if (seconds < 0.001) {
        return (seconds * 1000000).toFixed(3) + ' μs';
    } else if (seconds < 1) {
        return (seconds * 1000).toFixed(3) + ' ms';
    } else {
        return seconds.toFixed(3) + ' s';
    }
}

// Format number with precision
function formatNumber(num) {
    if (num === null || num === undefined) return '-';
    if (num < 0.0001) {
        return num.toExponential(3);
    }
    return num.toFixed(6);
}

// Fetch historical data from API
async function fetchHistoricalData(days = 100) {
    try {
        const response = await fetch(`${API_URL}/api/historical?days=${days}`);
        if (!response.ok) {
            throw new Error('Failed to fetch data');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching historical data:', error);
        throw error;
    }
}

// Update header based on JIT performance
function updateHeader(historicalData) {
    const runs = historicalData.historical_runs;
    if (runs.length === 0) return;

    // Find latest JIT and non-JIT runs
    const latestJit = runs.find(r => r.is_jit);
    const latestNonJit = runs.find(r => !r.is_jit);

    if (latestJit && latestNonJit && latestJit.geomean && latestNonJit.geomean) {
        const jitFaster = latestJit.geomean < latestNonJit.geomean;
        if (jitFaster) {
            headerSubtitle.textContent = `Yes! ${((1 - latestJit.geomean / latestNonJit.geomean) * 100).toFixed(1)}% faster on average 🚀`;
        } else {
            headerSubtitle.textContent = 'Not yet, but we\'re working on it!💪🏻';
        }
    } else {
        headerSubtitle.textContent = 'Python JIT vs Non-JIT Benchmark Performance Dashboard';
    }
}

// Render performance chart
function renderChart(data) {
    const runs = data.historical_runs;

    // Separate JIT and non-JIT runs, reverse to show chronological order
    const nonJitRuns = runs.filter(r => !r.is_jit).reverse();
    const jitRuns = runs.filter(r => r.is_jit).reverse();

    const ctx = document.getElementById('performance-chart').getContext('2d');

    // Destroy existing chart if it exists
    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Non-JIT',
                    data: nonJitRuns.map(r => ({
                        x: new Date(r.date),
                        y: r.geomean,
                        runData: r
                    })),
                    borderColor: '#764ba2',
                    backgroundColor: 'rgba(118, 75, 162, 0.1)',
                    pointBackgroundColor: '#764ba2',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3
                },
                {
                    label: 'JIT',
                    data: jitRuns.map(r => ({
                        x: new Date(r.date),
                        y: r.geomean,
                        runData: r
                    })),
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    pointBackgroundColor: '#667eea',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: true
            },
            onClick: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const datasetIndex = activeElements[0].datasetIndex;
                    const index = activeElements[0].index;
                    const clickedRun = chart.data.datasets[datasetIndex].data[index].runData;

                    // Find the corresponding run for the same date (JIT vs non-JIT)
                    const clickedDate = new Date(clickedRun.date).toISOString().split('T')[0];
                    const runsOnSameDate = historicalData.historical_runs.filter(r => {
                        const runDate = new Date(r.date).toISOString().split('T')[0];
                        return runDate === clickedDate;
                    });

                    showDetailView(clickedDate, runsOnSameDate);
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Performance Over Time (Geometric Mean)',
                    font: { size: 18 }
                },
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const date = new Date(items[0].parsed.x);
                            return date.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                            });
                        },
                        label: (context) => {
                            const runData = context.raw.runData;
                            return [
                                `${context.dataset.label}: ${formatTime(context.parsed.y)}`,
                                `Commit: ${runData.commit.substring(0, 7)}`,
                                `Click to view details`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        tooltipFormat: 'MMM d, yyyy',
                        displayFormats: {
                            day: 'MMM d'
                        }
                    },
                    title: {
                        display: true,
                        text: 'Date'
                    }
                },
                y: {
                    type: 'logarithmic',
                    title: {
                        display: true,
                        text: 'Geometric Mean (seconds, log scale)'
                    },
                    ticks: {
                        callback: (value) => formatTime(value)
                    }
                }
            }
        }
    });
}

// Show chart view
function showChartView() {
    loadingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    chartViewEl.classList.remove('hidden');
    detailViewEl.classList.add('hidden');
    window.location.hash = '';
}

// Show detail view for a specific date with comparison
function showDetailView(dateStr, runs) {
    chartViewEl.classList.add('hidden');
    detailViewEl.classList.remove('hidden');

    // Separate JIT and non-JIT runs
    const nonJitRun = runs.find(r => !r.is_jit);
    const jitRun = runs.find(r => r.is_jit);

    // Update summary with primary run (prefer non-JIT for display)
    const primaryRun = nonJitRun || jitRun;
    runDateEl.textContent = new Date(primaryRun.date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    pythonVersionEl.textContent = primaryRun.python_version;

    // Make commit hash a clickable link
    const commitShort = primaryRun.commit.substring(0, 7);
    commitHashEl.innerHTML = `<a href="https://github.com/python/cpython/commit/${primaryRun.commit}" target="_blank" rel="noopener noreferrer">${commitShort}</a>`;

    // Update results title
    const resultsTitle = document.getElementById('results-title');
    if (nonJitRun && jitRun) {
        resultsTitle.textContent = 'JIT vs Non-JIT Comparison';
        totalBenchmarksEl.textContent = `${Object.keys(nonJitRun.benchmarks).length} benchmarks`;
    } else if (jitRun) {
        resultsTitle.textContent = 'JIT Results';
        totalBenchmarksEl.textContent = `${Object.keys(jitRun.benchmarks).length} benchmarks`;
    } else {
        resultsTitle.textContent = 'Non-JIT Results';
        totalBenchmarksEl.textContent = `${Object.keys(nonJitRun.benchmarks).length} benchmarks`;
    }

    // Render comparison table
    renderComparisonTable(nonJitRun, jitRun);

    // Update URL hash
    window.location.hash = `run/${dateStr}`;
}

// Render comparison table
function renderComparisonTable(nonJitRun, jitRun) {
    // Get all unique benchmark names
    const allBenchmarks = new Set();
    if (nonJitRun) {
        Object.keys(nonJitRun.benchmarks).forEach(name => allBenchmarks.add(name));
    }
    if (jitRun) {
        Object.keys(jitRun.benchmarks).forEach(name => allBenchmarks.add(name));
    }

    // Build comparison data
    const comparisonData = Array.from(allBenchmarks).map(name => {
        const nonJitMean = nonJitRun?.benchmarks[name]?.mean;
        const jitMean = jitRun?.benchmarks[name]?.mean;

        let diff = null;
        let speedup = null;

        if (nonJitMean && jitMean) {
            diff = jitMean - nonJitMean;
            speedup = nonJitMean / jitMean; // >1 means JIT is faster
        }

        return {
            name,
            nonjit_mean: nonJitMean,
            jit_mean: jitMean,
            diff,
            speedup
        };
    });

    // Sort comparison data
    const sortedData = sortBenchmarks(comparisonData);

    // Clear existing rows
    benchmarkTbody.innerHTML = '';

    // Render rows
    sortedData.forEach(benchmark => {
        const row = document.createElement('tr');

        // Determine row class based on performance
        let rowClass = '';
        if (benchmark.speedup !== null) {
            if (benchmark.speedup < 1) {
                rowClass = 'jit-slower';
            } else if (benchmark.speedup > 1.05) {
                rowClass = 'jit-faster';
            }
        }
        if (rowClass) row.className = rowClass;

        // Format difference and speedup
        let diffText = '-';
        let speedupText = '-';
        let diffClass = 'neutral';
        let speedupClass = 'neutral';

        if (benchmark.diff !== null) {
            if (Math.abs(benchmark.diff) < 0.0000001) {
                diffText = '~0 s';
                speedupText = '1.00x';
            } else if (benchmark.diff < 0) {
                diffText = formatTime(Math.abs(benchmark.diff)) + ' faster';
                diffClass = 'faster';
                speedupText = benchmark.speedup.toFixed(2) + 'x';
                speedupClass = 'faster';
            } else {
                diffText = formatTime(benchmark.diff) + ' slower';
                diffClass = 'slower';
                speedupText = benchmark.speedup.toFixed(2) + 'x';
                speedupClass = 'slower';
            }
        }

        row.innerHTML = `
            <td>${benchmark.name}</td>
            <td>${benchmark.nonjit_mean ? formatTime(benchmark.nonjit_mean) : '-'}</td>
            <td>${benchmark.jit_mean ? formatTime(benchmark.jit_mean) : '-'}</td>
            <td class="${diffClass}">${diffText}</td>
            <td class="${speedupClass}">${speedupText}</td>
        `;
        benchmarkTbody.appendChild(row);
    });
}

// Sort benchmarks by column
function sortBenchmarks(benchmarks) {
    const { column, direction } = currentSort;

    return benchmarks.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];

        // Handle null/undefined values
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;

        // Compare values
        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        if (direction === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
    });
}

// Handle table header clicks for sorting
function handleSort(column) {
    if (currentSort.column === column) {
        // Toggle direction
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
    }

    // Update UI
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
    });

    const currentTh = document.querySelector(`th[data-sort="${column}"]`);
    currentTh.classList.add(`sort-${currentSort.direction}`);

    // Re-render table with current data from URL hash
    const hash = window.location.hash;
    if (hash.startsWith('#run/')) {
        const dateStr = hash.substring(5);
        const runsOnDate = historicalData.historical_runs.filter(r => {
            const runDateStr = new Date(r.date).toISOString().split('T')[0];
            return runDateStr === dateStr;
        });

        if (runsOnDate.length > 0) {
            const nonJitRun = runsOnDate.find(r => !r.is_jit);
            const jitRun = runsOnDate.find(r => r.is_jit);
            renderComparisonTable(nonJitRun, jitRun);
        }
    }
}

// Handle search input
function handleSearch(query) {
    const rows = benchmarkTbody.getElementsByTagName('tr');
    const lowerQuery = query.toLowerCase();

    Array.from(rows).forEach(row => {
        const benchmarkName = row.cells[0].textContent.toLowerCase();
        if (benchmarkName.includes(lowerQuery)) {
            row.classList.remove('hidden');
        } else {
            row.classList.add('hidden');
        }
    });
}

// Handle navigation based on URL hash
function handleNavigation() {
    const hash = window.location.hash;

    if (hash.startsWith('#run/')) {
        const dateStr = hash.substring(5);
        const runsOnDate = historicalData.historical_runs.filter(r => {
            const runDateStr = new Date(r.date).toISOString().split('T')[0];
            return runDateStr === dateStr;
        });

        if (runsOnDate.length > 0) {
            showDetailView(dateStr, runsOnDate);
        } else {
            showChartView();
        }
    } else {
        showChartView();
    }
}

// Initialize app
async function init() {
    try {
        // Show loading state
        loadingEl.classList.remove('hidden');
        errorEl.classList.add('hidden');
        chartViewEl.classList.add('hidden');
        detailViewEl.classList.add('hidden');

        // Fetch data
        const data = await fetchHistoricalData();
        historicalData = data;

        // Update header
        updateHeader(data);

        // Render chart
        renderChart(data);

        // Setup event listeners
        backButton.addEventListener('click', () => {
            showChartView();
        });

        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.getAttribute('data-sort');
                handleSort(column);
            });
        });

        searchInput.addEventListener('input', (e) => {
            handleSearch(e.target.value);
        });

        // Handle browser back/forward
        window.addEventListener('hashchange', handleNavigation);

        // Show initial view based on URL
        handleNavigation();

    } catch (error) {
        // Show error state
        loadingEl.classList.add('hidden');
        errorEl.classList.remove('hidden');
        console.error('Error initializing app:', error);
    }
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
