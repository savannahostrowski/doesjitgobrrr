import { type Component, createResource, createSignal, createEffect, Show } from 'solid-js';
import { Router, Route, useNavigate, useParams, type RouteSectionProps } from '@solidjs/router';
import { ThemeProvider } from './ThemeContext';
import Header from './components/Header';
import PerformanceChart from './components/PerformanceChart';
import DetailView from './components/DetailView';
import About from './components/About';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorState from './components/ErrorState';
import { fetchHistoricalByDate, fetchHistoricalSummary } from './api';
import type { BenchmarkRun, DateRange, GoalLines } from './types';
import { isValidGoalValue } from './types';
import './App.css';

const GOAL_LINES_STORAGE_KEY = 'goalLines';

/** Parse goal lines from a comma-separated string */
function parseGoalLinesFromString(goals: string): GoalLines {
  // Handle explicit "none" value
  if (goals === 'none') {
    return { show5: false, show10: false, custom: null };
  }

  const values = goals.split(',');

  // Parse custom value - any number that's not 5 or 10
  let custom: number | null = null;
  for (const v of values) {
    if (v !== '5' && v !== '10') {
      const num = parseFloat(v);
      if (isValidGoalValue(num)) {
        custom = num;
      }
    }
  }

  return {
    show5: values.includes('5'),
    show10: values.includes('10'),
    custom,
  };
}

/** Get initial goal lines from URL or localStorage */
function getInitialGoalLines(): GoalLines {
  const params = new globalThis.URLSearchParams(globalThis.location.search);
  const goals = params.get('goals');
  if (goals) return parseGoalLinesFromString(goals);

  // Fallback to localStorage for persistence across sessions
  try {
    const stored = globalThis.localStorage.getItem(GOAL_LINES_STORAGE_KEY);
    if (stored === 'none') {
      // User explicitly turned off all goals
      return { show5: false, show10: false, custom: null };
    }
    if (stored) return parseGoalLinesFromString(stored);
  } catch {
    // localStorage may be unavailable in private browsing mode
  }

  // Default: show 5% goal line (only for first-time visitors)
  return { show5: true, show10: false, custom: null };
}

/** Serialize goal lines to URL search param value */
function serializeGoalLines(goalLines: GoalLines): string | null {
  const values: string[] = [];
  if (goalLines.show5) values.push('5');
  if (goalLines.show10) values.push('10');
  if (goalLines.custom !== null) values.push(String(goalLines.custom));
  return values.length > 0 ? values.join(',') : null;
}

const ChartView: Component = () => {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = createSignal<DateRange>(30);
  const [historicalData, { refetch }] = createResource(dateRange, (days) =>
    fetchHistoricalSummary(days === 'all' ? 1000 : days)
  );

  // Initialize goal lines from URL
  const [goalLines, setGoalLines] = createSignal<GoalLines>(
    getInitialGoalLines()
  );

  // Sync goal lines to URL and localStorage
  createEffect(() => {
    const serialized = serializeGoalLines(goalLines());
    const cleanUrl = globalThis.location.pathname + (serialized ? `?goals=${serialized}` : '');
    globalThis.history.replaceState(null, '', cleanUrl);

    // Persist to localStorage for cross-session persistence
    try {
      // Store 'none' explicitly when all goals are off to distinguish from "never set"
      globalThis.localStorage.setItem(GOAL_LINES_STORAGE_KEY, serialized || 'none');
    } catch {
      // localStorage may be unavailable in private browsing mode
    }
  });

  // Flatten machines data into a single array
  const allRuns = () => {
    const data = historicalData();
    if (!data?.machines) return [];
    const runs: BenchmarkRun[] = [];
    for (const machineRuns of Object.values(data.machines)) {
      runs.push(...machineRuns);
    }
    return runs;
  };

  const handlePointClick = (dateStr: string) => {
    navigate(`/run/${dateStr}`);
  };

  // Show loading spinner only on initial load, not when switching filters
  const hasData = () => historicalData() !== undefined;

  return (
    <Show
      when={hasData() || historicalData.error}
      fallback={<LoadingSpinner />}
    >
      <Show when={historicalData.error}>
        <ErrorState onRetry={() => refetch()} />
      </Show>
      <Show when={!historicalData.error}>
        <div class="chart-view-wrapper">
          <PerformanceChart
            data={allRuns()}
            onPointClick={handlePointClick}
            dateRange={dateRange()}
            onDateRangeChange={setDateRange}
            goalLines={goalLines()}
            onGoalLinesChange={setGoalLines}
            isLoading={historicalData.loading}
          />
        </div>
      </Show>
    </Show>
  );
};

const DetailViewRoute: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  // Fetch data only for the specific date from URL
  const [historicalData] = createResource(
    () => params.date,
    (date) => fetchHistoricalByDate(date)
  );

  // Flatten machines data into a single array
  const allRuns = () => {
    const data = historicalData();
    if (!data?.machines) return [];
    const runs: BenchmarkRun[] = [];
    for (const machineRuns of Object.values(data.machines)) {
      runs.push(...machineRuns);
    }
    return runs;
  };

  const runsOnDate = () => {
    const data = allRuns();

    // If no runs, return empty
    if (data.length === 0) return [];

    // Group by machine first, then by commit within each machine
    // This matches the chart's per-machine deduplication logic
    const machineLatestCommit = new Map<string, string>();

    // For each machine, find its latest commit based on directory_name
    const byMachine = new Map<string, Map<string, BenchmarkRun[]>>();
    data.forEach(run => {
      const machine = run.machine || 'unknown';
      if (!byMachine.has(machine)) {
        byMachine.set(machine, new Map());
      }
      const commitMap = byMachine.get(machine)!;
      if (!commitMap.has(run.commit)) {
        commitMap.set(run.commit, []);
      }
      commitMap.get(run.commit)!.push(run);
    });

    // For each machine, find the commit with the latest directory name (actual benchmark run)
    byMachine.forEach((commitMap, machine) => {
      let latestCommit = '';
      let latestDirName = '';

      commitMap.forEach((runs, commit) => {
        const maxDirName = runs.reduce((max, run) => {
          const dirName = run.directory_name || '';
          return dirName > max ? dirName : max;
        }, '');

        if (maxDirName > latestDirName) {
          latestDirName = maxDirName;
          latestCommit = commit;
        }
      });

      machineLatestCommit.set(machine, latestCommit);
    });

    // Now filter to only include runs from each machine's latest commit
    return data.filter(run => {
      const machine = run.machine || 'unknown';
      const latestCommit = machineLatestCommit.get(machine);
      return run.commit === latestCommit;
    });
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <Show
      when={!historicalData.loading}
      fallback={<LoadingSpinner />}
    >
      <Show
        when={runsOnDate().length > 0}
        fallback={
          <>
            <p>No data found for this date.</p>
            <button onClick={handleBack}>← Back to Chart</button>
          </>
        }
      >
        <DetailView runs={runsOnDate()} onBack={handleBack} />
      </Show>
    </Show>
  );
};

const Layout: Component<RouteSectionProps> = (props) => {
  return (
    <>
      <Header />
      <main>
        {props.children}
      </main>
      <footer>
        <p>
          Made with 🖤 by 
          <a
            href="https://github.com/savannahostrowski"
            target="_blank"
            rel="noopener noreferrer"
          >
            Savannah Ostrowski
          </a>
        </p>
      </footer>
    </>
  );
};

const App: Component = () => {
  return (
    <ThemeProvider>
      <div class="app">
        <Router root={(props) => <Layout {...props} />}>
          <Route path="/" component={ChartView} />
          <Route path="/run/:date" component={DetailViewRoute} />
          <Route path="/about" component={About} />
        </Router>
      </div>
    </ThemeProvider>
  );
};

export default App;
