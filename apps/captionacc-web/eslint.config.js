import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      import: importPlugin,
    },
    rules: {
      // CRITICAL: Ban 'as any' - use proper types instead
      '@typescript-eslint/no-explicit-any': 'error',

      // Stricter TypeScript rules
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn', // Warn about unhandled promises
      '@typescript-eslint/no-misused-promises': 'warn', // Warn about promises in event handlers
      '@typescript-eslint/strict-boolean-expressions': 'off', // Too strict for now

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React best practices
      'react/prop-types': 'off', // Using TypeScript
      'react/react-in-jsx-scope': 'off', // React 17+
      'react/no-unescaped-entities': 'warn', // Warn about unescaped quotes/apostrophes

      // Accessibility
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'warn',

      // Import organization
      'import/no-duplicates': 'error',
      'import/no-unused-modules': 'warn',
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc' },
        },
      ],

      // Complexity limits
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],

      // Make other rules warnings (don't block commits)
      'no-console': 'off',
      'no-undef': 'off', // TypeScript handles this, and causes false positives with React
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // JS files use different rules (no TypeScript)
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: false, // Don't use TypeScript for JS files
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      '.react-router/**',
      'build/**',
      'node_modules/**',
      'public/**', // Browser scripts
    ],
  }
)
