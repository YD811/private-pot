# Test Directory

This directory contains all test files for PotBot.

## Structure

```
tests/
├── setup.ts           # Global test setup and configuration
├── example.test.ts    # Example tests (delete after creating real tests)
├── bot/               # Tests for bot features
│   ├── features/      # Feature tests
│   ├── handlers/      # Handler tests
│   ├── middlewares/   # Middleware tests
│   └── helpers/       # Helper function tests
├── server/            # Tests for web server
└── utils/             # Test utilities and mocks
    ├── mocks/         # Mock implementations
    └── fixtures/      # Test data fixtures
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test tests/bot/features/deposits.test.ts

# Run tests matching pattern
npm test -- --grep="deposit"
```

## Writing Tests

### Test File Naming

- Test files should mirror source structure
- Use `.test.ts` extension
- Example: `src/bot/features/deposits.ts` → `tests/bot/features/deposits.test.ts`

### Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup before each test
  })

  afterEach(() => {
    // Cleanup after each test
  })

  describe('specific functionality', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test'
      
      // Act
      const result = functionToTest(input)
      
      // Assert
      expect(result).toBe('expected')
    })
  })
})
```

### TDD Workflow

1. **Write test first** - Define expected behavior
2. **Run test** - Verify it fails (red)
3. **Write minimal code** - Make test pass (green)
4. **Refactor** - Improve code quality
5. **Repeat** - Continue the cycle

### Test Types

**Unit Tests**
- Test individual functions/classes in isolation
- Mock external dependencies
- Fast execution

**Integration Tests**
- Test multiple components together
- Test with real dependencies when needed
- May be slower

**Example Unit Test**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { generateDepositCode } from '#root/bot/features/deposits.js'

describe('generateDepositCode', () => {
  it('should generate unique 8-character code', () => {
    const code = generateDepositCode()
    expect(code).toHaveLength(8)
    expect(code).toMatch(/^[A-Z0-9]+$/)
  })
})
```

**Example Integration Test**
```typescript
import { describe, it, expect } from 'vitest'
import { createMockContext } from '../utils/mocks/context.js'
import { handleDeposit } from '#root/bot/features/deposits.js'

describe('Deposit Feature Integration', () => {
  it('should handle deposit command end-to-end', async () => {
    const ctx = createMockContext()
    await handleDeposit(ctx)
    
    expect(ctx.reply).toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('deposit code')
    )
  })
})
```

## Mocking

### Mock Functions
```typescript
import { vi } from 'vitest'

const mockFn = vi.fn()
mockFn.mockReturnValue('result')
mockFn.mockResolvedValue('async result')
```

### Mock Modules
```typescript
vi.mock('#root/services/database', () => ({
  getUser: vi.fn(),
  saveUser: vi.fn(),
}))
```

### Mock Telegram Context
See `tests/utils/mocks/context.ts` for creating mock bot contexts.

## Coverage

Coverage reports are generated in the `coverage/` directory.

**Minimum Thresholds:**
- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

View HTML coverage report:
```bash
npm run test:coverage
open coverage/index.html
```

## Best Practices

1. **Test behavior, not implementation**
2. **Use descriptive test names** - "it should ..." format
3. **One assertion per test** (when practical)
4. **Arrange-Act-Assert** pattern
5. **Keep tests independent** - no shared state
6. **Mock external dependencies** - database, APIs, etc.
7. **Test edge cases** - null, undefined, empty, error conditions
8. **Keep tests fast** - unit tests should be < 100ms

## Common Patterns

### Testing async operations
```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction()
  expect(result).toBe('expected')
})
```

### Testing errors
```typescript
it('should throw error for invalid input', () => {
  expect(() => {
    functionThatThrows()
  }).toThrow('Expected error message')
})

// Async errors
it('should reject promise on error', async () => {
  await expect(asyncFunctionThatFails()).rejects.toThrow()
})
```

### Testing with timeouts
```typescript
it('should complete within time limit', async () => {
  const start = Date.now()
  await functionToTest()
  const duration = Date.now() - start
  expect(duration).toBeLessThan(1000)
}, { timeout: 2000 })
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [TDD Guide](https://martinfowler.com/bliki/TestDrivenDevelopment.html)

