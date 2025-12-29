import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    rules: {
      // CRITICAL: Ban 'as any' - use proper types instead
      '@typescript-eslint/no-explicit-any': 'error',

      // Make other rules warnings (don't block commits)
      'no-console': 'off',
      'no-undef': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // JS files use different rules
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
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
