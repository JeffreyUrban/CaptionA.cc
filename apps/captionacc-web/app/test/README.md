# Testing Guide

This directory contains the test setup and configuration for the project.

## Testing Stack

- **Vitest**: Fast unit test framework (Vite-native)
- **@testing-library/react**: React component testing utilities
- **@testing-library/jest-dom**: Custom Jest matchers for DOM assertions
- **@testing-library/user-event**: User interaction simulation
- **jsdom**: DOM implementation for Node.js

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with UI (visual test runner)
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

## Writing Tests

### Unit Tests

Create test files alongside the code they test with the `.test.ts` or `.test.tsx` extension:

```
app/
  lib/
    formatDate.ts
    formatDate.test.ts  ← Test file
  components/
    Button.tsx
    Button.test.tsx     ← Test file
```

### Test Structure

```typescript
import { describe, it, expect } from 'vitest'
import { myFunction } from './myFunction'

describe('myFunction', () => {
  it('should do something correctly', () => {
    const result = myFunction('input')
    expect(result).toBe('expected output')
  })
})
```

### Component Tests

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MyComponent } from './MyComponent'

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})
```

## Coverage Reports

Coverage reports are generated in the `coverage/` directory when running `npm run test:coverage`.

Minimum coverage targets:

- Statements: 80%
- Branches: 80%
- Functions: 80%
- Lines: 80%

## CI/CD Integration

Tests run automatically on every pull request and push to main via GitHub Actions.
All tests must pass before merging.

## Next Steps

- [ ] Add component tests for UI components
- [ ] Add E2E tests with Playwright
- [ ] Add visual regression tests
- [ ] Increase test coverage to 80%+
