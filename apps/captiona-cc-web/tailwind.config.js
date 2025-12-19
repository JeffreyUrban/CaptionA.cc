/** @type {import('tailwindcss').Config} */
import typographyPlugin from '@tailwindcss/typography'
import typographyStyles from './typography'

export default {
  content: ['./app/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  plugins: [typographyPlugin],
  theme: {
    fontSize: {
      xs: ['0.8125rem', { lineHeight: '1.5rem' }],
      sm: ['0.875rem', { lineHeight: '1.5rem' }],
      base: ['1rem', { lineHeight: '1.75rem' }],
      lg: ['1.125rem', { lineHeight: '1.75rem' }],
      xl: ['1.25rem', { lineHeight: '2rem' }],
      '2xl': ['1.5rem', { lineHeight: '2rem' }],
      '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
      '4xl': ['2rem', { lineHeight: '2.5rem' }],
      '5xl': ['3rem', { lineHeight: '3.5rem' }],
      '6xl': ['3.75rem', { lineHeight: '1' }],
      '7xl': ['4.5rem', { lineHeight: '1' }],
      '8xl': ['6rem', { lineHeight: '1' }],
      '9xl': ['8rem', { lineHeight: '1' }],
    },
    extend: {
      typography: {
        DEFAULT: {
          css: {
            // Reduce spacing before headings
            'h2': {
              marginTop: '1.5rem',
              marginBottom: '1rem',
            },
            'h3': {
              marginTop: '1rem',
              marginBottom: '0.75rem',
            },
            'h4': {
              marginTop: '0.75rem',
              marginBottom: '0.5rem',
            },
            // Reduce spacing around lists
            'ul': {
              marginTop: '0.5rem',
              marginBottom: '0.5rem',
            },
            'li': {
              marginTop: '0.25rem',
              marginBottom: '0.25rem',
            },
            // Adjust paragraph spacing
            'p': {
              marginTop: '0.75rem',
              marginBottom: '0.75rem',
            },
          },
        },
      },
    },
    typography: typographyStyles,
  },
}
