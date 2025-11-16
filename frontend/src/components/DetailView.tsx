import { type Component } from 'solid-js';
import type { BenchmarkRun, ComparisonRow } from '../types';
import BenchmarkTable from './BenchmarkTable';

interface DetailViewProps {
  runs: BenchmarkRun[];
  onBack: () => void;
}

const DetailView: Component<DetailViewProps> = (props) => {
  const nonJitRun = () => props.runs.find(r => !r.is_jit);
  const jitRun = () => props.runs.find(r => r.is_jit);
  const primaryRun = () => nonJitRun() || jitRun();

  const comparisonData = (): ComparisonRow[] => {
    const allBenchmarks = new Set<string>();
    const nonJit = nonJitRun();
    const jit = jitRun();

    if (nonJit) {
      Object.keys(nonJit.benchmarks).forEach(name => allBenchmarks.add(name));
    }
    if (jit) {
      Object.keys(jit.benchmarks).forEach(name => allBenchmarks.add(name));
    }

    return Array.from(allBenchmarks)
      .map(name => {
        const nonJitMean = nonJit?.benchmarks[name]?.mean ?? null;
        const jitMean = jit?.benchmarks[name]?.mean ?? null;

        let diff: number | null = null;
        let speedup: number | null = null;

        if (nonJitMean !== null && jitMean !== null) {
          diff = jitMean - nonJitMean;
          speedup = nonJitMean / jitMean;
        }

        return {
          name,
          nonjit_mean: nonJitMean,
          jit_mean: jitMean,
          diff,
          speedup,
        };
      })
      .filter(row => row.nonjit_mean !== null && row.jit_mean !== null);
  };

  const totalBenchmarks = () => {
    const nonJit = nonJitRun();
    const jit = jitRun();

    if (nonJit) {
      return `${Object.keys(nonJit.benchmarks).length} benchmarks`;
    }
    if (jit) {
      return `${Object.keys(jit.benchmarks).length} benchmarks`;
    }
    return '0 benchmarks';
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <>
      <div class="back-button-container">
        <button class="back-button" onClick={props.onBack}>
          ← Back to Home
        </button>
      </div>

      <section class="summary-compact">
        <h2>Benchmark Run Details</h2>
        <ul class="summary-list">
          <li>
            <span class="label">Date:</span> {primaryRun() ? formatDate(primaryRun()!.date) : '-'}
          </li>
          <li>
            <span class="label">Python Version:</span> {primaryRun()?.python_version || '-'}
          </li>
          <li>
            <span class="label">Commit:</span>{' '}
            {primaryRun() ? (
              <a
                href={`https://github.com/python/cpython/commit/${primaryRun()!.commit}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {primaryRun()!.commit.substring(0, 7)}
              </a>
            ) : (
              '-'
            )}
          </li>
          <li>
            <span class="label">Total Benchmarks:</span> {totalBenchmarks()}
          </li>
        </ul>
      </section>

      <BenchmarkTable data={comparisonData()} />
    </>
  );
};

export default DetailView;
