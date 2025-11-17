import { type Component, createSignal } from 'solid-js';
import { useTheme } from '../ThemeContext';
import type { BenchmarkRun } from '../types';

interface HeaderProps {
  runs: BenchmarkRun[];
}

const Header: Component<HeaderProps> = (props) => {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = createSignal(false);

  const toggleMenu = () => setMenuOpen(!menuOpen());

  const closeMenu = () => setMenuOpen(false);

  const subtitle = () => {
    if (props.runs.length === 0) {
      return 'Python JIT vs Non-JIT Benchmark Performance Dashboard';
    }

    // Find the latest JIT run with speedup data (geometric mean)
    const latestJit = props.runs.find(r => r.is_jit && r.speedup !== null && r.speedup !== undefined);

    if (latestJit?.speedup) {
      const speedup = latestJit.speedup;

      // speedup = nonjit_geomean / jit_geomean
      // speedup > 1.0 means JIT is faster
      // speedup < 1.0 means JIT is slower

      if (speedup > 1.0) {
        // JIT is faster
        const percentFaster = ((speedup - 1) * 100).toFixed(1);
        return `JIT went brrrr! On the latest run, it was ${percentFaster}% faster on average 🚀`;
      } else if (speedup < 1.0) {
        // JIT is slower
        const percentSlower = ((1 - speedup) * 100).toFixed(1);
        return `JIT did not go brrr! On the latest run, it was ${percentSlower}% slower on average 🐢`;
      } else {
        // Same performance
        return 'Same performance! 🤝';
      }
    }

    return 'Python JIT vs Non-JIT Benchmark Performance Dashboard';
  };

  return (
    <header class="header">
      <button
        class="hamburger"
        onClick={toggleMenu}
        aria-label="Toggle menu"
        aria-expanded={menuOpen()}
      >
        <span class="hamburger-line" />
        <span class="hamburger-line" />
        <span class="hamburger-line" />
      </button>

      <nav class={`header-nav ${menuOpen() ? 'menu-open' : ''}`}>
        <a href="/" class="nav-link" onClick={closeMenu}>Home</a>
        <a href="/about" class="nav-link" onClick={closeMenu}>About</a>
        <button class="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme() === 'dark' ? '☀️' : '🌙'}
        </button>
        <a
          href="https://github.com/savannahostrowski/doesjitgobrrr"
          class="github-link"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
        >
          <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
      </nav>

      <a href="/" class="header-title-link">
        <h1>does JIT go brrr?</h1>
      </a>
      <p class="header-subtitle">{subtitle()}</p>
    </header>
  );
};

export default Header;
