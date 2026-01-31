# Integration Guide - Wiring Services Together

## Overview

All core services and features are implemented and tested. This guide shows how to integrate them into the bot's main entry point.

## Integration Steps

### 1. Initialize Services

Create a services container in `src/services/index.ts`:

```typescript
import { Connection } from '@solana/web3.js'
import { prisma } from '#root/db.js'
import { config } from '#root/config.js'
import { WalletService } from './wallet.js'
import { DepositCodeService } from './deposit-code.js'
import { GroupService } from './group.js'
import { TransactionMonitorService } from './transaction-monitor.js'

export function createServices() {
  const connection = new Connection(config.solanaRpcUrl, 'confirmed')
  
  const walletService = new WalletService(
    config.walletMasterSeed,
    config.walletEncryptionKey,
  )
  
  const depositCodeService = new DepositCodeService()
  
  const groupService = new GroupService(prisma, walletService)
  
  const transactionMonitor = new TransactionMonitorService(connection, prisma)
  
  return {
    connection,
    walletService,
    depositCodeService,
    groupService,
    transactionMonitor,
    prisma,
  }
}

export type Services = ReturnType<typeof createServices>
```

### 2. Update Bot Context

Add services to context in `src/bot/context.ts`:

```typescript
import type { Services } from '#root/services/index.js'

interface ExtendedContextFlavor {
  logger: Logger
  config: Config
  services: Services  // Add this
}
```

### 3. Wire Features to Bot

Update `src/bot/index.ts`:

```typescript
import { startFeature } from '#root/bot/features/start.js'
import { depositFeature } from '#root/bot/features/deposit.js'
import type { Services } from '#root/services/index.js'

export function createBot(
  token: string,
  dependencies: Dependencies & { services: Services },
  botConfig?: BotConfig<Context>
) {
  const { config, logger, services } = dependencies
  
  // ... existing setup ...
  
  // Add services to context
  bot.use(async (ctx, next) => {
    ctx.services = services
    await next()
  })
  
  // ... existing middlewares ...
  
  // Add new features
  protectedBot.use(startFeature(services.prisma, services.groupService))
  protectedBot.use(depositFeature(services.prisma, services.depositCodeService))
  protectedBot.use(welcomeFeature)
  protectedBot.use(adminFeature)
  
  if (isMultipleLocales)
    protectedBot.use(languageFeature)
  
  protectedBot.use(unhandledFeature)
  
  return bot
}
```

### 4. Start Transaction Monitoring

Create monitoring loop in `src/services/monitoring.ts`:

```typescript
import type { Bot } from '#root/bot/index.js'
import type { Services } from './index.js'
import type { Logger } from '#root/logger.js'

export class MonitoringService {
  private intervalId?: NodeJS.Timeout
  private isRunning = false

  constructor(
    private readonly services: Services,
    private readonly bot: Bot,
    private readonly logger: Logger,
  ) {}

  async start(intervalMs: number = 10000) {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.logger.info('Starting transaction monitoring')

    this.intervalId = setInterval(async () => {
      await this.pollAllWallets()
    }, intervalMs)

    await this.pollAllWallets()
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.isRunning = false
    this.logger.info('Stopped transaction monitoring')
  }

  private async pollAllWallets() {
    try {
      const groups = await this.services.prisma.group.findMany({
        select: { id: true, telegramGroupId: true, walletAddress: true },
      })

      for (const group of groups) {
        const publicKey = new PublicKey(group.walletAddress)
        
        await this.services.transactionMonitor.monitorWallet(
          publicKey,
          async (groupId) => {
            await this.notifyDeposit(groupId)
          },
        )
      }
    }
    catch (error) {
      this.logger.error({ error }, 'Error polling wallets')
    }
  }

  private async notifyDeposit(groupId: string) {
    try {
      const group = await this.services.prisma.group.findUnique({
        where: { id: groupId },
      })

      if (!group) {
        return
      }

      const lastDeposit = await this.services.prisma.deposit.findFirst({
        where: { groupId },
        orderBy: { createdAt: 'desc' },
        include: { member: true },
      })

      if (!lastDeposit) {
        return
      }

      const solAmount = Number(lastDeposit.amount) / 1_000_000_000
      const username = lastDeposit.member.telegramUsername
        ? `@${lastDeposit.member.telegramUsername}`
        : `User ${lastDeposit.member.telegramUserId}`

      await this.bot.api.sendMessage(
        group.telegramGroupId,
        `✅ <b>Deposit Confirmed!</b>\n\n` +
        `${username} deposited <b>${solAmount.toFixed(4)} SOL</b>\n\n` +
        `Total fund: <b>${(Number(group.totalDeposits) / 1_000_000_000).toFixed(4)} SOL</b>`,
        { parse_mode: 'HTML' },
      )
    }
    catch (error) {
      this.logger.error({ error }, 'Error notifying deposit')
    }
  }
}
```

### 5. Update Main Entry Point

Update `src/main.ts`:

```typescript
import { createServices } from '#root/services/index.js'
import { MonitoringService } from '#root/services/monitoring.js'

async function main() {
  const logger = createLogger(config)
  const services = createServices()

  const bot = createBot(config.botToken, {
    config,
    logger,
    services,
  })

  const monitoringService = new MonitoringService(services, bot, logger)

  if (config.isPollingMode) {
    await run(bot)
    await monitoringService.start()
  } else {
    const server = await createServer(bot, config)
    await monitoringService.start()
    // ... webhook setup
  }

  // Graceful shutdown
  onShutdown(async () => {
    logger.info('Shutting down...')
    await monitoringService.stop()
    await services.prisma.$disconnect()
    await bot.stop()
  })
}
```

## Testing Integration

### Unit Tests
All services have unit tests - already done ✅

### Integration Tests
Create integration tests in `tests/integration/`:

```typescript
// tests/integration/deposit-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServices } from '#root/services/index.js'

describe('Deposit Flow Integration', () => {
  let services: Services

  beforeAll(async () => {
    services = createServices()
    // Setup test database
  })

  afterAll(async () => {
    await services.prisma.$disconnect()
  })

  it('should complete full deposit flow', async () => {
    // Create group
    const group = await services.groupService.getOrCreateGroup('test-group')
    
    // Generate deposit code
    const code = services.depositCodeService.generateCode()
    
    // Create deposit code record
    await services.prisma.depositCode.create({
      data: {
        groupId: group.id,
        telegramUserId: '123',
        code,
        expiresAt: services.depositCodeService.getExpirationDate(),
      },
    })
    
    // Process deposit
    const success = await services.transactionMonitor.processDeposit(
      code,
      'test-signature',
      1000000000n, // 1 SOL
    )
    
    expect(success).toBe(true)
    
    // Verify deposit recorded
    const deposit = await services.prisma.deposit.findUnique({
      where: { transactionSignature: 'test-signature' },
    })
    
    expect(deposit).toBeDefined()
    expect(deposit?.amount).toBe(1000000000n)
  })
})
```

## Checklist

- [ ] Create `src/services/index.ts` with service initialization
- [ ] Update `src/bot/context.ts` to include services
- [ ] Update `src/bot/index.ts` to wire features
- [ ] Create `src/services/monitoring.ts` for transaction polling
- [ ] Update `src/main.ts` to start monitoring
- [ ] Add integration tests
- [ ] Update locales with new messages
- [ ] Test in development environment
- [ ] Document deployment process

## Next Features to Implement

After integration is complete:

1. **Admin Commands**
   - `/add_trader` - Grant trading permission
   - `/remove_trader` - Revoke trading permission
   - `/pause` - Emergency stop
   - `/unpause` - Resume trading

2. **Info Commands**
   - `/balance` - Show SOL and token balances
   - `/members` - List all members with ownership %
   - `/portfolio` - Show all holdings

3. **Trading System**
   - Jupiter SDK integration
   - `/buy` and `/sell` commands
   - Trade confirmation flow
   - Limit enforcement

4. **Portfolio Tracking**
   - Position management
   - PnL calculations
   - Historical tracking

## Environment Setup

Ensure all variables are set:

```bash
# Required
BOT_TOKEN=your-bot-token
DATABASE_URL=postgresql://user:pass@localhost:5432/potbot
WALLET_MASTER_SEED=your twelve word seed phrase
WALLET_ENCRYPTION_KEY=64-character-hex-string
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Optional
BOT_MODE=polling
DEBUG=true
LOG_LEVEL=info
```

## Running Tests

Before integration:
```bash
npm test                 # Run all tests
npm run test:coverage    # Check coverage
npm run typecheck        # Verify types
```

After integration:
```bash
npm run dev              # Test in development
npm run db:studio        # Inspect database
```

## Troubleshooting

**Services not found:**
- Ensure `src/services/index.ts` exports all services
- Check import paths use `#root/*` alias

**Context type errors:**
- Regenerate types: `npm run typecheck`
- Update context.ts with Services type

**Database connection fails:**
- Run `npm run db:generate`
- Check DATABASE_URL format
- Verify PostgreSQL is running

**Monitoring not working:**
- Check Solana RPC connection
- Verify groups have wallets
- Check logs for errors


