import { type Component, createResource, Show } from 'solid-js';
import { Router, Route, useNavigate, useParams, type RouteSectionProps } from '@solidjs/router';
import { ThemeProvider } from './ThemeContext';
import Header from './components/Header';
import PerformanceChart from './components/PerformanceChart';
import DetailView from './components/DetailView';
import About from './components/About';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorState from './components/ErrorState';
import { fetchHistoricalData } from './api';
import type { BenchmarkRun } from './types';
import './App.css';

const ChartView: Component<{ data: BenchmarkRun[] }> = (props) => {
  const navigate = useNavigate();

  const handlePointClick = (dateStr: string) => {
    navigate(`/run/${dateStr}`);
  };

  return (
    <div class="chart-view-wrapper">
      <PerformanceChart data={props.data} onPointClick={handlePointClick} />
    </div>
  );
};

const DetailViewRoute: Component<{ data: BenchmarkRun[] }> = (props) => {
  const params = useParams();
  const navigate = useNavigate();

  const runsOnDate = () => {
    const dateStr = params.date;
    // Filter runs for this date
    const runsForDate = props.data.filter(r => {
      const runDate = new Date(r.date).toISOString().split('T')[0];
      return runDate === dateStr;
    });

    // If no runs, return empty
    if (runsForDate.length === 0) return [];

    // Group by machine first, then by commit within each machine
    // This matches the chart's per-machine deduplication logic
    const machineLatestCommit = new Map<string, string>();

    // For each machine, find its latest commit based on created_at
    const byMachine = new Map<string, Map<string, BenchmarkRun[]>>();
    runsForDate.forEach(run => {
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
    return runsForDate.filter(run => {
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
  const [historicalData, { refetch }] = createResource(() => fetchHistoricalData(100));

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

  return (
    <ThemeProvider>
      <div class="app">
        <Show
          when={!historicalData.loading && !historicalData.error}
          fallback={
            <>
              <Header />
              <main>
                <Show when={historicalData.loading}>
                  <LoadingSpinner />
                </Show>
                <Show when={historicalData.error}>
                  <ErrorState onRetry={() => refetch()} />
                </Show>
              </main>
            </>
          }
        >
          <Router root={(props) => <Layout {...props} />}>
            <Route path="/" component={() => <ChartView data={allRuns()} />} />
            <Route path="/run/:date" component={() => <DetailViewRoute data={allRuns()} />} />
            <Route path="/about" component={About} />
          </Router>
        </Show>
      </div>
    </ThemeProvider>
  );
};

export default App;
