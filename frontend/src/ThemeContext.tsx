import { createContext, useContext, createSignal, type Component, type ParentProps } from 'solid-js';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: () => Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>();
const THEME_STORAGE_KEY = 'theme';

function getInitialTheme(): Theme {
  try {
    const stored = globalThis.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // localStorage may be unavailable
  }
  return 'dark';
}

export const ThemeProvider: Component<ParentProps> = (props) => {
  const initialTheme = getInitialTheme();
  const [theme, setTheme] = createSignal<Theme>(initialTheme);

  // Set initial theme immediately
  document.documentElement.setAttribute('data-theme', initialTheme);

  const toggleTheme = () => {
    const newTheme = theme() === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    try {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // localStorage may be unavailable
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {props.children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
