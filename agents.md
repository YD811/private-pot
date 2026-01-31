# Agent Navigation Guide

## Overview

This is **PotBot** - a Telegram bot that transforms group chats into trading funds with pooled Solana wallets. This codebase is built on the grammY framework with TypeScript.

## Essential Documentation

**Start here:**
- `@specs.md` - Complete product specification with architecture, features, and data models
- `/docs` - Hand-written documentation and specifications
- `/docs/generated` - Auto-generated documentation (testing guides, setup docs, etc.)

Always review `@specs.md` before implementing features to understand the full context of how the system should work.

## Development Philosophy: Test-Driven Development (TDD)

**CRITICAL: This project follows strict TDD practices.**

### The TDD Workflow

1. **Read the specification** - Understand requirements from `@specs.md` or task description
2. **Write tests FIRST** - Before writing any implementation code:
   - Define expected behavior in tests
   - Cover happy paths, edge cases, and error scenarios
   - Use clear, descriptive test names
3. **Run tests** - Verify tests fail for the right reasons (red phase)
4. **Write minimal code** - Implement just enough to make tests pass (green phase)
5. **Refactor** - Clean up code while keeping tests green
6. **run linter** — Run npx lint-staged and fix issues
6. **Repeat** - Continue the cycle for each new feature or bug fix

### Testing Practices

on every change run: `npm run lint` and fix issues

```
❌ DON'T: Write implementation first, add tests later
✅ DO: Write tests first, then implement
```

**Test Structure:**
- Unit tests for pure functions and business logic
- Integration tests for features that interact with external services (Telegram, Solana, Database)
- Test files should mirror source structure: `src/bot/features/deposits.ts` → `tests/bot/features/deposits.test.ts`

**When to test:**
- All new features
- All bug fixes (write a failing test that reproduces the bug first)
- All refactoring (tests should pass before and after)

## Project Structure

```
/Users/tim/workspace/pets/pot-bot/
├── docs/
│   ├── specs.md           # Product specification - READ THIS FIRST
│   ├── agents.md          # This file
│   └── generated/         # Auto-generated documentation
├── src/
│   ├── bot/               # Telegram bot code
│   │   ├── callback-data/ # Callback query data builders
│   │   ├── features/      # Bot features (commands, handlers)
│   │   ├── filters/       # Message/update filters
│   │   ├── handlers/      # Command handlers
│   │   ├── helpers/       # Utility functions
│   │   ├── keyboards/     # Inline/reply keyboard builders
│   │   ├── middlewares/   # Bot middlewares (session, logging, etc)
│   │   ├── context.ts     # Custom context type definition
│   │   ├── i18n.ts        # Internationalization setup
│   │   └── index.ts       # Bot initialization
│   ├── services/          # Business logic services
│   │   ├── jupiter.ts     # Jupiter DEX integration (quotes, swaps)
│   │   ├── wallet.ts      # Wallet encryption/decryption
│   │   ├── deposit-monitor.ts  # Background deposit monitoring
│   │   ├── token-balance.ts    # Token balance tracking
│   │   ├── pnl-cache.ts    # PnL calculation caching
│   │   └── ...
│   ├── server/            # Web server (webhook mode)
│   ├── config.ts          # App configuration
│   ├── logger.ts          # Logging setup (Pino)
│   └── main.ts            # Application entry point
├── prisma/
│   └── schema.prisma      # Database schema
├── locales/               # Translation files (Fluent)
│   └── en.ftl
├── tests/                 # Test directory
└── package.json
```

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **Bot Framework:** [grammY](https://grammy.dev/)
- **Server:** Hono (for webhooks)
- **Database:** PostgreSQL + [Prisma ORM](https://www.prisma.io/)
- **Blockchain:** Solana web3.js
- **DEX Integration:** [Jupiter API](https://station.jup.ag/)
- **Logger:** Pino
- **i18n:** Fluent (@grammyjs/i18n)
- **Validation:** Valibot
- **Testing:** Vitest

## Development Workflow

### Adding a New Feature

1. **Review specs** - Check `@specs.md` for feature requirements
2. **Plan tests** - Identify what needs testing:
   - Input validation
   - Business logic
   - Error handling
   - Integration points
3. **Write test file**:
   ```typescript
   // tests/bot/features/deposits.test.ts
   import { describe, it, expect } from 'vitest'
   
   describe('Deposit Feature', () => {
     it('should generate unique deposit code', () => {
       // Test implementation
     })
     
     it('should reject invalid deposit amounts', () => {
       // Test implementation
     })
   })
   ```
4. **Run tests** - `npm test` (should fail)
5. **Implement feature** in `src/`
6. **Run tests** - Keep iterating until green
7. **Refactor** - Improve code quality
8. **Commit** - Tests and implementation together

### Fixing a Bug

1. **Write a failing test** that reproduces the bug
2. **Verify test fails** with current code
3. **Fix the bug**
4. **Verify test passes**
5. **Check for regressions** - run full test suite

### Code Organization

**Features** (`src/bot/features/`):
- One file per feature or command group
- Export a composer or handlers
- Keep business logic separate from bot API calls

**Handlers** (`src/bot/handlers/`):
- Error handlers
- Special command handlers (like `/setcommands`)

**Middlewares** (`src/bot/middlewares/`):
- Session management
- Logging
- Authentication/authorization
- Rate limiting

**Keyboards** (`src/bot/keyboards/`):
- Reusable keyboard builders
- Use `callback-data` library for type-safe callbacks

**Callback Data** (`src/bot/callback-data/`):
- Type-safe callback query data builders
- Example: `ChangeLanguageData`

## Key Principles

### 1. Type Safety
- Use TypeScript strictly
- Define types for all data structures
- Use Valibot for runtime validation
- Extend grammY Context with custom types

### 2. Code Style (ESLint Rules)
**Import ordering** (perfectionist/sort-imports):
1. Type imports first
2. Then `#root/` imports (alphabetical)
3. Then external packages (alphabetical)
4. Then relative imports

```typescript
// ✅ Correct order
import type { Context } from '#root/bot/context.js'
import { config } from '#root/config.js'
import { PnLCacheService } from '#root/services/pnl-cache.js'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Composer, InlineKeyboard } from 'grammy'
```

**Always run `npm run lint` before committing** - pre-commit hooks enforce this.

### 3. i18n First
- All user-facing text through Fluent
- Never hardcode strings
- Support language switching
- Store translations in `locales/`

### 4. Error Handling
- Catch and log all errors
- Provide user-friendly error messages
- Use error handler middleware
- Don't expose internal errors to users

### 5. Logging
- Use Pino logger
- Log important events (trades, deposits)
- Include context (user ID, chat ID)
- Use appropriate log levels

### 6. Security
- Validate all inputs
- Check permissions before actions
- Encrypt sensitive data (wallet keys)
- Audit trail for all financial operations

## Bot-Specific Patterns

### Context Extension
```typescript
// src/bot/context.ts
export type Context = ParseModeFlavor<
  HydrateFlavor<
    ConversationFlavor<
      CommandsFlavor<
        I18nFlavor<
          SessionFlavor<Update.CallbackQueryUpdate>
        >
      >
    >
  >
>
```

### Feature Composition
```typescript
// src/bot/features/deposits.ts
import { Composer } from 'grammy'

export const depositsFeature = new Composer()

depositsFeature.command('deposit', async (ctx) => {
  // Handler implementation
})
```

### Callback Data
```typescript
// src/bot/callback-data/confirm-trade.ts
import { createCallbackData } from 'callback-data'

export const ConfirmTradeData = createCallbackData('confirm_trade', {
  tradeId: String,
  action: String, // 'execute' | 'cancel'
})
```

## Database Considerations

The project uses **Prisma ORM** with PostgreSQL. Key models:
- **Group** - Telegram group + wallet address
- **Member** - Group members with deposit addresses
- **Deposit** - Deposit transactions
- **Trade** - Buy/sell trade history
- **Position** - Current token holdings
- **Withdrawal** - Withdrawal records
- **DailyPnL** - Daily profit/loss snapshots
- **Commission** - Fee collection records

**Database workflow:**
1. Modify `prisma/schema.prisma`
2. Run `npm run db:generate` to regenerate Prisma client
3. Run `npm run db:push` to apply schema to database
4. Use `prisma.` client in code for data access

**Note:** This project uses `db:push` instead of migrations for schema changes.

**Amount storage:** All token/lamport amounts stored as `BigInt` in Prisma.

## Solana Integration

The bot interacts with Solana blockchain:
- Wallet generation per group (encrypted keys stored in DB)
- Transaction signing via `@solana/web3.js`
- Jupiter swap integration for token trades
- Deposit monitoring and sweeping

**Key Solana patterns:**
```typescript
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

// Create transfer transaction
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: fromWallet.publicKey,
    toPubkey: new PublicKey(toAddress),
    lamports: amount,
  }),
)

// Sign and send
tx.sign(wallet)
const signature = await connection.sendRawTransaction(tx.serialize())
await connection.confirmTransaction(signature, 'confirmed')
```

**Amount handling:**
- RPC returns `number` for balances - convert to `BigInt` for calculations
- Use `BigInt` for all lamport/token amounts to avoid precision loss
- LAMPORTS_PER_SOL = 1_000_000_000

**Testing strategy:**
- Mock Solana RPC calls in unit tests
- Use devnet for integration tests
- Test error scenarios (failed transactions, network issues)

## Available Commands

**Implemented:**
- `/start` - Bot initialization, get deposit address
- `/deposit` - Get personal deposit address
- `/buy <token> <amount>` - Buy tokens with SOL
- `/sell <token> <amount>` - Sell tokens for SOL
- `/balance` - Show group's SOL balance
- `/portfolio` - Show all token holdings and PnL
- `/history` - Show recent trades
- `/members` - Show group members and ownership
- `/limits` - Show trading limits
- `/withdraw` - Withdraw funds (admin)

**Admin commands:**
- `/add_trader` - Grant trading permissions
- `/remove_trader` - Revoke trading permissions
- `/set_limit` - Set per-trade or daily limits
- `/pause` - Pause trading
- `/unpause` - Resume trading
- `/admin_trading` - Execute trades as admin

## Testing Setup (To Be Configured)

Recommended setup:
```json
// package.json
{
  "scripts": {
    "test": "vitest",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest --coverage"
  }
}
```

Install:
```bash
npm install -D vitest @vitest/ui
```

## Common Tasks

### Add a new command
1. Write tests in `tests/bot/features/`
2. Create feature in `src/bot/features/`
3. Register in `src/bot/index.ts`
4. Add translations to `locales/en.ftl`
5. Update command list

### Add middleware
1. Write tests in `tests/bot/middlewares/`
2. Create middleware in `src/bot/middlewares/`
3. Register in `src/bot/index.ts`

### Add configuration
1. Define schema in `src/config.ts` using Valibot
2. Add to `.env` or `.env.example`
3. Environment variables are auto-converted from `SNAKE_CASE` to `camelCase`
4. Use via `config` object

**Example:**
```typescript
// src/config.ts
operatorFeeWalletAddress: v.optional(v.pipe(v.string(), v.minLength(32)), undefined)

// Use in code
import { config } from '#root/config.js'
if (config.operatorFeeWalletAddress) {
  // ...
}
```

## References

- [grammY Documentation](https://grammy.dev/)
- [grammY Plugins](https://grammy.dev/plugins/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Jupiter API](https://station.jup.ag/docs/apis/quote-api)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vitest Documentation](https://vitest.dev/)
- [Fluent Project](https://projectfluent.org/)

## Questions to Ask Yourself

Before implementing anything:
1. Have I read the relevant section in `@specs.md`?
2. Have I written tests first?
3. Do my tests cover edge cases?
4. Is this code type-safe?
5. Are all strings internationalized?
6. Is error handling in place?
7. Is this properly logged?
8. Does this follow the project structure?

## Remember

> **Write the test. Watch it fail. Make it pass. Refactor. Repeat.**

This is not optional - it's the foundation of quality, maintainable code.

