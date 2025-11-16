import { createContext, useContext, createSignal, type Component, type ParentProps } from 'solid-js';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: () => Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>();

export const ThemeProvider: Component<ParentProps> = (props) => {
  const [theme, setTheme] = createSignal<Theme>('dark');

  const toggleTheme = () => {
    const newTheme = theme() === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // Set initial theme
  document.documentElement.setAttribute('data-theme', theme());

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
