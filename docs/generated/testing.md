# Testing Guide for PotBot

## Quick Start

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with UI (visual interface)
npm run test:ui

# Run tests with coverage report
npm run test:coverage

# Run coverage without failing on thresholds (for development)
npm run test:coverage:dev
```

## TDD Workflow

**ALWAYS follow Test-Driven Development:**

1. ✍️ **Write test first** - Define expected behavior
2. ❌ **Run test** - Verify it fails (red phase)
3. ✅ **Write code** - Make test pass (green phase)
4. ♻️ **Refactor** - Improve code quality
5. 🔁 **Repeat** - Continue the cycle

### Example: Adding a Deposit Feature

#### Step 1: Write the test FIRST

```typescript
// tests/bot/features/deposits.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createMockGroupContext } from '../../utils/mocks/context.js'
import { handleDeposit } from '#root/bot/features/deposits.js'

describe('Deposit Feature', () => {
  it('should generate unique deposit code when /deposit is called', async () => {
    // Arrange
    const ctx = createMockGroupContext()
    
    // Act
    await handleDeposit(ctx)
    
    // Assert
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('deposit code')
    )
  })

  it('should include wallet address in response', async () => {
    // Arrange
    const ctx = createMockGroupContext()
    
    // Act
    await handleDeposit(ctx)
    
    // Assert
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringMatching(/[A-Za-z0-9]{32,44}/) // Solana address pattern
    )
  })

  it('should only work in group chats', async () => {
    // Arrange
    const ctx = createMockPrivateContext()
    
    // Act
    await handleDeposit(ctx)
    
    // Assert
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('only available in groups')
    )
  })
})
```

#### Step 2: Run the test (it should FAIL)

```bash
npm test tests/bot/features/deposits.test.ts
```

Expected: ❌ Error - module not found (because we haven't written the code yet)

#### Step 3: Write minimal code to make it pass

```typescript
// src/bot/features/deposits.ts
import { Composer } from 'grammy'
import type { Context } from '../context.js'

export const depositsFeature = new Composer<Context>()

export async function handleDeposit(ctx: Context) {
  // Check if in group
  if (ctx.chat?.type === 'private') {
    await ctx.reply('This command is only available in groups')
    return
  }

  // Generate deposit code (simplified for now)
  const depositCode = Math.random().toString(36).substring(2, 10).toUpperCase()
  
  // Get wallet address (mocked for now)
  const walletAddress = 'DemoWalletAddress123456789'
  
  await ctx.reply(
    `Your deposit code: ${depositCode}\nWallet address: ${walletAddress}`
  )
}

depositsFeature.command('deposit', handleDeposit)
```

#### Step 4: Run tests again

```bash
npm test tests/bot/features/deposits.test.ts
```

Expected: ✅ All tests pass

#### Step 5: Refactor and improve

Now you can improve the code (extract functions, add proper wallet generation, etc.) while keeping tests green.

## Test Structure

### Directory Structure

```
tests/
├── bot/
│   ├── features/           # Feature tests
│   │   ├── deposits.test.ts
│   │   ├── trading.test.ts
│   │   └── admin.test.ts
│   ├── handlers/           # Handler tests
│   ├── middlewares/        # Middleware tests
│   └── helpers/            # Helper function tests
├── utils/
│   ├── mocks/             # Mock implementations
│   │   └── context.ts     # Mock Telegram context
│   └── fixtures/          # Test data
└── setup.ts               # Global test setup
```

### Test File Naming

- Mirror source structure: `src/bot/features/deposits.ts` → `tests/bot/features/deposits.test.ts`
- Use `.test.ts` extension
- One test file per source file

### Test Naming Convention

```typescript
describe('Feature/Module Name', () => {
  describe('specific function or behavior', () => {
    it('should do something specific when condition', () => {
      // test implementation
    })
  })
})
```

Examples:
- ✅ `it('should generate 8-character deposit code')`
- ✅ `it('should reject negative deposit amounts')`
- ✅ `it('should only allow traders to execute swaps')`
- ❌ `it('test deposit')` (too vague)
- ❌ `it('works')` (not descriptive)

## Common Test Patterns

### Testing Bot Commands

```typescript
import { describe, it, expect } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

describe('Balance Command', () => {
  it('should display SOL balance', async () => {
    const ctx = createMockContext()
    
    await handleBalance(ctx)
    
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('SOL')
    )
  })
})
```

### Testing with Mocks

```typescript
import { vi } from 'vitest'

// Mock external service
vi.mock('#root/services/solana', () => ({
  getBalance: vi.fn().mockResolvedValue(1.5),
  sendTransaction: vi.fn().mockResolvedValue('tx-hash-123'),
}))

it('should fetch balance from Solana', async () => {
  const { getBalance } = await import('#root/services/solana')
  
  await handleBalance(ctx)
  
  expect(getBalance).toHaveBeenCalledWith('wallet-address')
})
```

### Testing Async Operations

```typescript
it('should handle async swap execution', async () => {
  const ctx = createMockContext()
  
  await executeSwap(ctx, 'JUP', 10)
  
  expect(ctx.reply).toHaveBeenCalled()
})
```

### Testing Errors

```typescript
it('should throw error for invalid amount', () => {
  expect(() => {
    validateAmount(-10)
  }).toThrow('Amount must be positive')
})

// Async errors
it('should handle failed transactions', async () => {
  await expect(
    executeSwap(ctx, 'INVALID', 100)
  ).rejects.toThrow('Transaction failed')
})
```

### Testing Permissions

```typescript
import { createMockContext } from '../../utils/mocks/context.js'

it('should only allow traders to execute swaps', async () => {
  const ctx = createMockContext()
  ctx.session = { role: 'member' } // Not a trader
  
  await handleBuy(ctx)
  
  expect(ctx.reply).toHaveBeenCalledWith(
    expect.stringContaining('not authorized')
  )
})
```

### Testing Callback Queries

```typescript
import { createMockCallbackContext } from '../../utils/mocks/context.js'

it('should execute trade when confirmed', async () => {
  const ctx = createMockCallbackContext('confirm_trade:123:execute')
  
  await handleTradeConfirmation(ctx)
  
  expect(ctx.answerCallbackQuery).toHaveBeenCalled()
  expect(ctx.editMessageText).toHaveBeenCalledWith(
    expect.stringContaining('executed')
  )
})
```

## Coverage Reports

### View Coverage

After running `npm run test:coverage`, open the HTML report:

```bash
open coverage/index.html
```

### Coverage Thresholds

Minimum required coverage:
- Lines: 80%
- Functions: 80%
- Branches: 80%
- Statements: 80%

**Note:** During development, use `npm run test:coverage:dev` to view coverage without failing on thresholds.

### What to Test

**DO test:**
- ✅ Business logic
- ✅ Input validation
- ✅ Error handling
- ✅ Permission checks
- ✅ State changes
- ✅ Integration points

**DON'T test:**
- ❌ External libraries (they have their own tests)
- ❌ Simple getters/setters with no logic
- ❌ Type definitions

## Best Practices

### 1. Test Behavior, Not Implementation

```typescript
// ❌ BAD - tests implementation details
it('should call generateCode function', () => {
  const spy = vi.spyOn(utils, 'generateCode')
  createDeposit()
  expect(spy).toHaveBeenCalled()
})

// ✅ GOOD - tests behavior
it('should create deposit with unique code', () => {
  const deposit = createDeposit()
  expect(deposit.code).toMatch(/^[A-Z0-9]{8}$/)
})
```

### 2. Arrange-Act-Assert Pattern

```typescript
it('should calculate ownership percentage', () => {
  // Arrange - Setup test data
  const userDeposit = 100
  const totalDeposits = 1000
  
  // Act - Execute the function
  const percentage = calculateOwnership(userDeposit, totalDeposits)
  
  // Assert - Verify the result
  expect(percentage).toBe(10)
})
```

### 3. One Assertion Per Test (when practical)

```typescript
// ✅ GOOD - focused tests
it('should return correct percentage', () => {
  expect(calculateOwnership(50, 100)).toBe(50)
})

it('should handle zero total', () => {
  expect(calculateOwnership(10, 0)).toBe(0)
})

// ⚠️ ACCEPTABLE - related assertions
it('should create valid deposit object', () => {
  const deposit = createDeposit(100)
  expect(deposit).toHaveProperty('code')
  expect(deposit).toHaveProperty('amount')
  expect(deposit.amount).toBe(100)
})
```

### 4. Keep Tests Independent

```typescript
// ❌ BAD - tests depend on each other
let sharedUser
it('should create user', () => {
  sharedUser = createUser()
  expect(sharedUser).toBeDefined()
})
it('should update user', () => {
  updateUser(sharedUser) // Depends on previous test
})

// ✅ GOOD - independent tests
it('should create user', () => {
  const user = createUser()
  expect(user).toBeDefined()
})
it('should update user', () => {
  const user = createUser() // Each test sets up its own data
  updateUser(user)
  expect(user.updated).toBe(true)
})
```

### 5. Use Descriptive Variable Names

```typescript
// ❌ BAD
it('should work', () => {
  const u = { d: 100 }
  const t = 1000
  const r = calc(u.d, t)
  expect(r).toBe(10)
})

// ✅ GOOD
it('should calculate correct ownership percentage', () => {
  const userDeposit = 100
  const totalDeposits = 1000
  const ownershipPercentage = calculateOwnership(userDeposit, totalDeposits)
  expect(ownershipPercentage).toBe(10)
})
```

### 6. Test Edge Cases

```typescript
describe('calculateOwnership', () => {
  it('should handle normal case', () => {
    expect(calculateOwnership(50, 100)).toBe(50)
  })
  
  it('should handle zero deposit', () => {
    expect(calculateOwnership(0, 100)).toBe(0)
  })
  
  it('should handle zero total', () => {
    expect(calculateOwnership(10, 0)).toBe(0)
  })
  
  it('should handle equal amounts', () => {
    expect(calculateOwnership(100, 100)).toBe(100)
  })
  
  it('should handle decimal results', () => {
    expect(calculateOwnership(33, 100)).toBe(33)
  })
})
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
```

## Troubleshooting

### Tests fail with "Cannot find module"

Make sure TypeScript paths are configured correctly in `vitest.config.ts`:

```typescript
resolve: {
  alias: {
    '#root': resolve(__dirname, './src'),
  },
}
```

### "Coverage threshold not met"

This is expected during development. Use:
```bash
npm run test:coverage:dev
```

### Tests hang or timeout

Increase timeout in `vitest.config.ts`:
```typescript
test: {
  testTimeout: 30000, // 30 seconds
}
```

Or in individual tests:
```typescript
it('should complete', async () => {
  // test code
}, { timeout: 30000 })
```

### Mock not working

Make sure to call `vi.mock` before importing the module:

```typescript
vi.mock('#root/services/database')
import { getUser } from '#root/services/database'
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Test-Driven Development](https://martinfowler.com/bliki/TestDrivenDevelopment.html)
- [grammY Testing Guide](https://grammy.dev/guide/testing.html)

## Getting Help

1. Check test output for error messages
2. Review existing tests for patterns
3. Read `tests/README.md` for more details
4. Refer to `@specs.md` for feature requirements

---

**Remember: Write tests first, then implement. This is not optional—it's the foundation of quality code.**

