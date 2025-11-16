import { type Component } from 'solid-js';
import { useTheme } from '../ThemeContext';
import type { BenchmarkRun } from '../types';

interface HeaderProps {
  runs: BenchmarkRun[];
}

const Header: Component<HeaderProps> = (props) => {
  const { theme, toggleTheme } = useTheme();
  const subtitle = () => {
    if (props.runs.length === 0) {
      return 'Python JIT vs Non-JIT Benchmark Performance Dashboard';
    }

    const latestJit = props.runs.find(r => r.is_jit);
    const latestNonJit = props.runs.find(r => !r.is_jit);

    if (latestJit && latestNonJit && latestJit.geomean && latestNonJit.geomean) {
      const jitFaster = latestJit.geomean < latestNonJit.geomean;
      if (jitFaster) {
        const percentFaster = ((1 - latestJit.geomean / latestNonJit.geomean) * 100).toFixed(1);
        return `Yes! ${percentFaster}% faster on average 🚀`;
      } else {
        return 'Not yet, but we\'re working on it! 💪🏻';
      }
    }

    return 'Python JIT vs Non-JIT Benchmark Performance Dashboard';
  };

  return (
    <header class="header">
      <nav class="header-nav">
        <a href="/" class="nav-link">Home</a>
        <a href="/about" class="nav-link">About</a>
        <button class="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme() === 'dark' ? '☀️' : '🌙'}
        </button>
      </nav>
      <a href="/" class="header-title-link">
        <h1>does JIT go brrr?</h1>
      </a>
      <p>{subtitle()}</p>
    </header>
  );
};

export default Header;
