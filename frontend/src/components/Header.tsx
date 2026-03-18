import { type Component, createSignal, Show } from 'solid-js';
import { useTheme } from '../ThemeContext';

const Header: Component = () => {
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = createSignal(false);

  const toggleMenu = () => setMenuOpen(!menuOpen());
  const closeMenu = () => setMenuOpen(false);

  return (
    <header class="header">
      <button
        class={`hamburger ${menuOpen() ? 'is-open' : ''}`}
        onClick={toggleMenu}
        aria-label="Toggle menu"
        aria-expanded={menuOpen()}
      >
        <span class="hamburger-line" />
        <span class="hamburger-line" />
        <span class="hamburger-line" />
      </button>

      <a href="/" class="header-logo">
        <span class="header-logo-text">doesjitgobrrr</span>
        <span class="header-logo-dot">.</span>
        <span class="header-logo-tld">com</span>
      </a>

      {/* Desktop nav */}
      <nav class="header-nav-desktop">
        <a href="/" class="nav-link">Home</a>
        <a href="/about" class="nav-link">About</a>
        <a
          href="https://github.com/savannahostrowski/doesjitgobrrr"
          class="nav-link nav-link-icon"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <button class="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
          {theme() === 'dark' ? '☀️' : '🌙'}
        </button>
      </nav>

      {/* Mobile overlay */}
      <Show when={menuOpen()}>
        <div class="mobile-overlay" onClick={closeMenu} />
      </Show>

      {/* Mobile slide-out */}
      <nav class={`mobile-nav ${menuOpen() ? 'is-open' : ''}`}>
        <div class="mobile-nav-header">
          <span class="mobile-nav-title">doesjitgobrrr</span>
          <div class="mobile-nav-header-actions">
            <button class="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
              {theme() === 'dark' ? '☀️' : '🌙'}
            </button>
            <button class="mobile-nav-close" onClick={closeMenu} aria-label="Close menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="mobile-nav-links">
          <a href="/" class="mobile-nav-link" onClick={closeMenu}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            Home
          </a>
          <a href="/about" class="mobile-nav-link" onClick={closeMenu}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            About
          </a>
          <a
            href="https://github.com/savannahostrowski/doesjitgobrrr"
            class="mobile-nav-link"
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </a>
        </div>
      </nav>
    </header>
  );
};

export default Header;
