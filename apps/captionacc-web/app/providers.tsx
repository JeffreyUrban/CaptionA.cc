'use client';

import React, {createContext, Dispatch, SetStateAction, useContext, useEffect, useRef, useState} from 'react';
import { useLocation } from 'react-router';

// Custom hook to track the previous value
function usePrevious<T>(value: T) {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  // eslint-disable-next-line react-hooks/refs
  return ref.current;
}

type Theme = "dark" | "light" | null;

// Adjust the context creation to reflect the new Theme type
const ThemeContext = createContext<{
    theme: Theme;
    toggleTheme: () => void;
}>({
    theme: null, // Default value
    toggleTheme: () => {}, // Placeholder function
});

// Custom ThemeProvider to manage theme state
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Specify the useState hook to use the Theme type
    const [theme, setTheme]: [Theme, Dispatch<SetStateAction<Theme>>] = useState<Theme>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const storedTheme = localStorage.getItem('theme');
            const systemPreference = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            const initialTheme: Theme = (storedTheme === 'dark' || storedTheme === 'light') ? storedTheme : systemPreference;

            // eslint-disable-next-line react-hooks/set-state-in-effect
            setTheme(initialTheme);
            document.documentElement.classList.toggle('dark', initialTheme === 'dark');
        }
    }, []);

    useEffect(() => {
        if (theme !== null && typeof window !== 'undefined') {
            document.documentElement.classList.toggle('dark', theme === 'dark');
        }
    }, [theme]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: { matches: boolean | undefined; }) => {
            // Apply system preference only if no user preference is stored
            if (!localStorage.getItem('theme')) {
                const newTheme = e.matches ? 'dark' : 'light';
                setTheme(newTheme);
                document.documentElement.classList.toggle('dark', e.matches);
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme); // Update theme state
        if (typeof window !== 'undefined') {
            localStorage.setItem('theme', newTheme); // Persist user preference explicitly
            document.documentElement.classList.toggle('dark', newTheme === 'dark');
        }
    };

    const value = { theme: theme ?? 'light', toggleTheme };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};

// Use this hook to access theme-related functions and state in your components
export function useTheme() {
  return useContext(ThemeContext);
}

// AppContext for storing previous pathname
export const AppContext = createContext<{ previousPathname?: string | undefined }>({});

export function Providers({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const previousPathname = usePrevious(location.pathname);

  return (
      <AppContext.Provider value={{ previousPathname }}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </AppContext.Provider>
  );
}
