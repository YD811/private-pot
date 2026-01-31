# Testing Quick Reference

## Commands

```bash
npm test                    # Run all tests once
npm run test:watch          # Watch mode (auto-rerun)
npm run test:ui             # Visual UI
npm run test:coverage       # Coverage report (enforces thresholds)
npm run test:coverage:dev   # Coverage without threshold enforcement
```

## TDD Cycle

1. 🔴 **RED** - Write failing test
2. 🟢 **GREEN** - Make it pass
3. 🔵 **REFACTOR** - Improve code
4. 🔁 **REPEAT**

## Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup before each test
  })

  it('should do something when condition', () => {
    // Arrange
    const input = 'value'
    
    // Act
    const result = functionToTest(input)
    
    // Assert
    expect(result).toBe('expected')
  })
})
```

## Common Assertions

```typescript
// Equality
expect(actual).toBe(expected)           // ===
expect(actual).toEqual(expected)        // Deep equality
expect(actual).not.toBe(value)          // Negation

// Truthiness
expect(value).toBeTruthy()
expect(value).toBeFalsy()
expect(value).toBeNull()
expect(value).toBeUndefined()
expect(value).toBeDefined()

// Numbers
expect(value).toBeGreaterThan(3)
expect(value).toBeGreaterThanOrEqual(3)
expect(value).toBeLessThan(10)
expect(value).toBeCloseTo(0.3)          // Floats

// Strings
expect(str).toContain('substring')
expect(str).toMatch(/regex/)
expect(str).toHaveLength(5)

// Arrays
expect(arr).toContain(item)
expect(arr).toHaveLength(3)
expect(arr).toEqual([1, 2, 3])

// Objects
expect(obj).toHaveProperty('key')
expect(obj).toHaveProperty('key', 'value')
expect(obj).toMatchObject({ a: 1 })

// Errors
expect(() => fn()).toThrow()
expect(() => fn()).toThrow('Error message')
expect(async () => asyncFn()).rejects.toThrow()

// Functions
expect(mockFn).toHaveBeenCalled()
expect(mockFn).toHaveBeenCalledWith(arg1, arg2)
expect(mockFn).toHaveBeenCalledTimes(2)
```

## Mocking

```typescript
// Mock function
const mockFn = vi.fn()
mockFn.mockReturnValue('value')
mockFn.mockResolvedValue('async value')
mockFn.mockRejectedValue(new Error())

// Mock module
vi.mock('#root/services/database', () => ({
  getUser: vi.fn(),
  saveUser: vi.fn(),
}))

// Clear mocks
vi.clearAllMocks()      // Clear call history
vi.resetAllMocks()      // Clear + reset implementation
vi.restoreAllMocks()    // Restore original implementation
```

## Test Telegram Bot

```typescript
import { createMockContext } from '../utils/mocks/context.js'

it('should reply to command', async () => {
  const ctx = createMockContext()
  
  await myCommandHandler(ctx)
  
  expect(ctx.reply).toHaveBeenCalledWith('Response')
})

// Group chat
const groupCtx = createMockGroupContext()

// Private chat
const privateCtx = createMockPrivateContext()

// Callback query
const callbackCtx = createMockCallbackContext('callback_data')
```

## Async Tests

```typescript
// Async/await
it('should handle async', async () => {
  const result = await asyncFunction()
  expect(result).toBe('value')
})

// Promises
it('should resolve', () => {
  return expect(promise).resolves.toBe('value')
})

it('should reject', () => {
  return expect(promise).rejects.toThrow()
})
```

## Test Organization

```
tests/
├── bot/
│   ├── features/       # Feature tests
│   ├── handlers/       # Handler tests
│   ├── middlewares/    # Middleware tests
│   └── helpers/        # Helper tests
└── utils/
    ├── mocks/          # Mock implementations
    └── fixtures/       # Test data
```

## Best Practices

✅ **DO:**
- Write test before code (TDD)
- Test behavior, not implementation
- Use descriptive test names
- Keep tests independent
- Test edge cases
- Mock external dependencies

❌ **DON'T:**
- Write code before tests
- Test implementation details
- Share state between tests
- Skip edge cases
- Test external libraries

## Coverage Thresholds

Minimum: 80% for all metrics
- Lines
- Functions
- Branches
- Statements

## Resources

- `docs/generated/testing.md` - Full testing guide
- `tests/README.md` - Test directory guide
- `tests/template.test.ts` - Test template
- [Vitest Docs](https://vitest.dev/)

