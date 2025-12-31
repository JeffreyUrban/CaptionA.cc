import js from '@eslint/js'
import importPlugin from 'eslint-plugin-import'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

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

      // Complexity limits - enforce the standards we just achieved
      complexity: ['warn', 15], // Keep at warning for gradual improvements
      'max-depth': ['warn', 4], // Enforce clean nesting
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],

      // Code quality - prevent common issues
      'no-console': 'off', // Allow console for server-side logging
      'no-undef': 'off', // TypeScript handles this, and causes false positives with React
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_', // Allow _unused parameters
          varsIgnorePattern: '^_', // Allow _unused variables
          caughtErrorsIgnorePattern: '^_', // Allow _error in catch blocks
        },
      ],

      // Prevent anti-patterns that we just cleaned up
      'no-duplicate-imports': 'error', // Use import grouping instead
      'prefer-const': 'warn', // Encourage immutability
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
