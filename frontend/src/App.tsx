import { type Component, createResource, Show } from 'solid-js';
import { Router, Route, useNavigate, useParams, useLocation, type RouteSectionProps } from '@solidjs/router';
import { ThemeProvider } from './ThemeContext';
import Header from './components/Header';
import PerformanceChart from './components/PerformanceChart';
import DetailView from './components/DetailView';
import About from './components/About';
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
    return props.data.filter(r => {
      const runDate = new Date(r.date).toISOString().split('T')[0];
      return runDate === dateStr;
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

const Layout: Component<RouteSectionProps & { runs: BenchmarkRun[] }> = (props) => {
  return (
    <>
      <Header runs={props.runs} />
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
  const [historicalData] = createResource(() => fetchHistoricalData(100));

  return (
    <ThemeProvider>
      <div class="app">
        <Show
          when={!historicalData.loading && !historicalData.error}
          fallback={
            <>
              <Header runs={[]} />
              <main>
                <Show when={historicalData.loading}>
                  <div class="loading">
                    <p>Loading benchmark data...</p>
                  </div>
                </Show>
                <Show when={historicalData.error}>
                  <div class="error">
                    <p>Failed to load benchmark data. Please try again later.</p>
                  </div>
                </Show>
              </main>
            </>
          }
        >
          <Router root={(props) => <Layout runs={historicalData()?.historical_runs || []} {...props} />}>
            <Route path="/" component={() => <ChartView data={historicalData()?.historical_runs || []} />} />
            <Route path="/run/:date" component={() => <DetailViewRoute data={historicalData()?.historical_runs || []} />} />
            <Route path="/about" component={About} />
          </Router>
        </Show>
      </div>
    </ThemeProvider>
  );
};

export default App;
