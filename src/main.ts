#!/usr/bin/env tsx
/* eslint-disable antfu/no-top-level-await */

import type { PollingConfig, WebhookConfig } from '#root/config.js'
import type { RunnerHandle } from '@grammyjs/runner'
import process from 'node:process'
import { createBot } from '#root/bot/index.js'
import { config } from '#root/config.js'
import { prisma } from '#root/db.js'
import { logger } from '#root/logger.js'
import { createServer, createServerManager } from '#root/server/index.js'
import { DailyPnLScheduler } from '#root/services/daily-pnl-scheduler.js'
import { DailyPnLService } from '#root/services/daily-pnl.js'
import { DepositMonitorService } from '#root/services/deposit-monitor.js'
import { GroupService } from '#root/services/group.js'
import { createJupiterService } from '#root/services/jupiter-factory.js'
import { PnLCacheService } from '#root/services/pnl-cache.js'
import { PrivacySweepProcessor } from '#root/services/privacy-sweep-processor.js'
import { PrivacyWithdrawProcessor } from '#root/services/privacy-withdraw-processor.js'
import { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { TokenBalanceService } from '#root/services/token-balance.js'
import { WalletService } from '#root/services/wallet.js'
import { run } from '@grammyjs/runner'

async function startPolling(config: PollingConfig) {
  // Use separate RPC URLs for read-only (background) vs write (transactions) operations
  const readOnlyRpcUrl = config.solanaRpcUrlReadOnly || config.solanaRpcUrl
  const writeRpcUrl = config.solanaRpcUrl

  // Rate limiter for write operations (transactions) - more conservative
  const writeRateLimiter = RPCRateLimiter.getInstance(logger, {
    minRequestInterval: 2000, // 2 seconds
    maxRetries: 1, // Reduced to 1 to fail faster on webhook requests
    baseRetryDelay: 10000, // 10 seconds
    maxConsecutiveRateLimits: 5,
    maxRetryDelay: 300000, // 5 minutes max
    circuitBreakerThreshold: 10, // Fail fast after 10 consecutive errors
  })

  // Rate limiter for read-only operations (background jobs) - can be more lenient
  const readOnlyRateLimiter = new RPCRateLimiter(logger, {
    minRequestInterval: 1000, // 1 second (faster for reads)
    maxRetries: 2,
    baseRetryDelay: 5000, // 5 seconds
    maxConsecutiveRateLimits: 10,
    maxRetryDelay: 60000, // 1 minute max
    circuitBreakerThreshold: 20, // More lenient for background jobs
  })

  // Initialize wallet service (write operations - uses write RPC)
  const walletService = new WalletService(
    config.walletMasterSeed,
    config.walletEncryptionKey,
    writeRpcUrl,
    writeRateLimiter,
  )

  const bot = createBot(config.botToken, {
    config,
    logger,
  })
  let runner: undefined | RunnerHandle

  // Start deposit monitor (read operations - uses read-only RPC)
  const depositMonitor = new DepositMonitorService(
    prisma,
    readOnlyRpcUrl,
    logger,
    readOnlyRateLimiter,
  )

  // Initialize services for daily PnL
  const groupService = new GroupService(prisma, walletService)
  // Jupiter service for transactions (write operations)
  const jupiterService = createJupiterService(writeRpcUrl, logger)
  // Token balance service for background jobs (read operations with rotation)
  const tokenBalanceService = new TokenBalanceService(readOnlyRpcUrl, readOnlyRateLimiter, logger)
  const dailyPnLService = new DailyPnLService(
    prisma,
    groupService,
    jupiterService,
    tokenBalanceService,
  )
  const dailyPnLScheduler = new DailyPnLScheduler(dailyPnLService, logger)

  // Initialize PnL cache service (updates every 60 minutes / once per hour)
  const pnlCacheService = new PnLCacheService(
    prisma,
    groupService,
    jupiterService,
    tokenBalanceService,
    logger,
    60, // 60 minutes (once per hour)
  )

  // Initialize Privacy Sweep Processor (processes pending Privacy Cash deposit sweeps)
  const privacySweepProcessor = config.privacyCashEnabled
    ? new PrivacySweepProcessor(prisma, writeRpcUrl, logger)
    : null

  // Initialize Privacy Withdraw Processor (processes pending Privacy Cash withdrawals)
  const privacyWithdrawProcessor = config.privacyCashEnabled
    ? new PrivacyWithdrawProcessor(prisma, writeRpcUrl, logger)
    : null

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown')
    pnlCacheService.stop()
    dailyPnLScheduler.stop()
    depositMonitor.stop()
    privacySweepProcessor?.stop()
    privacyWithdrawProcessor?.stop()
    await runner?.stop()
  })

  await Promise.all([
    bot.init(),
    bot.api.deleteWebhook(),
  ])

  // Set bot and wallet service in deposit monitor
  depositMonitor.setBot(bot)
  depositMonitor.setWalletService(walletService)

  // Set bot and wallet service in privacy sweep processor
  if (privacySweepProcessor) {
    privacySweepProcessor.setBot(bot)
    privacySweepProcessor.setWalletService(walletService)
  }

  // Set bot and wallet service in privacy withdraw processor
  if (privacyWithdrawProcessor) {
    privacyWithdrawProcessor.setBot(bot)
    privacyWithdrawProcessor.setWalletService(walletService)
  }

  // start bot
  logger.info({
    msg: 'Starting polling with allowed_updates',
    allowed_updates: config.botAllowedUpdates,
  })

  runner = run(bot, {
    runner: {
      fetch: {
        allowed_updates: config.botAllowedUpdates,
      },
    },
  })

  // Start monitoring deposits (check every 60 seconds to avoid rate limits)
  try {
    await depositMonitor.start(60000)
    logger.info('Deposit monitor started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start deposit monitor')
    // Don't fail the entire startup if deposit monitor fails
  }

  // Start daily PnL scheduler
  try {
    dailyPnLScheduler.start()
    logger.info('Daily PnL scheduler started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start daily PnL scheduler')
    // Don't fail the entire startup if scheduler fails
  }

  // Start PnL cache service (recalculates PnL hourly)
  try {
    pnlCacheService.start()
    logger.info('PnL cache service started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start PnL cache service')
    // Don't fail the entire startup if cache service fails
  }

  // Start Privacy Sweep Processor (if enabled)
  if (privacySweepProcessor) {
    try {
      await privacySweepProcessor.start(30000) // Check every 30 seconds
      logger.info('Privacy sweep processor started successfully')
    }
    catch (error) {
      logger.error({ error }, 'Failed to start privacy sweep processor')
    }
  }

  // Start Privacy Withdraw Processor (if enabled)
  if (privacyWithdrawProcessor) {
    try {
      await privacyWithdrawProcessor.start(30000) // Check every 30 seconds
      logger.info('Privacy withdraw processor started successfully')
    }
    catch (error) {
      logger.error({ error }, 'Failed to start privacy withdraw processor')
    }
  }

  logger.info({
    msg: 'Bot running...',
    username: bot.botInfo.username,
  })
}

async function startWebhook(config: WebhookConfig) {
  // Use separate RPC URLs for read-only (background) vs write (transactions) operations
  const readOnlyRpcUrl = config.solanaRpcUrlReadOnly || config.solanaRpcUrl
  const writeRpcUrl = config.solanaRpcUrl

  // Rate limiter for write operations (transactions) - more conservative
  const writeRateLimiter = RPCRateLimiter.getInstance(logger, {
    minRequestInterval: 2000, // 2 seconds
    maxRetries: 1, // Reduced to 1 to fail faster on webhook requests
    baseRetryDelay: 10000, // 10 seconds
    maxConsecutiveRateLimits: 5,
    maxRetryDelay: 300000, // 5 minutes max
    circuitBreakerThreshold: 10, // Fail fast after 10 consecutive errors
  })

  // Rate limiter for read-only operations (background jobs) - can be more lenient
  const readOnlyRateLimiter = new RPCRateLimiter(logger, {
    minRequestInterval: 1000, // 1 second (faster for reads)
    maxRetries: 2,
    baseRetryDelay: 5000, // 5 seconds
    maxConsecutiveRateLimits: 10,
    maxRetryDelay: 60000, // 1 minute max
    circuitBreakerThreshold: 20, // More lenient for background jobs
  })

  // Initialize wallet service (write operations - uses write RPC)
  const walletService = new WalletService(
    config.walletMasterSeed,
    config.walletEncryptionKey,
    writeRpcUrl,
    writeRateLimiter,
  )

  const bot = createBot(config.botToken, {
    config,
    logger,
  })
  const server = createServer({
    bot,
    config,
    logger,
  })
  const serverManager = createServerManager(server, {
    host: config.serverHost,
    port: config.serverPort,
  })

  // Start deposit monitor (read operations - uses read-only RPC)
  const depositMonitor = new DepositMonitorService(
    prisma,
    readOnlyRpcUrl,
    logger,
    readOnlyRateLimiter,
  )

  // Initialize services for daily PnL
  const groupService = new GroupService(prisma, walletService)
  // Jupiter service for transactions (write operations)
  const jupiterService = createJupiterService(writeRpcUrl, logger)
  // Token balance service for background jobs (read operations with rotation)
  const tokenBalanceService = new TokenBalanceService(readOnlyRpcUrl, readOnlyRateLimiter, logger)
  const dailyPnLService = new DailyPnLService(
    prisma,
    groupService,
    jupiterService,
    tokenBalanceService,
  )
  const dailyPnLScheduler = new DailyPnLScheduler(dailyPnLService, logger)

  // Initialize PnL cache service (updates every 60 minutes / once per hour)
  const pnlCacheService = new PnLCacheService(
    prisma,
    groupService,
    jupiterService,
    tokenBalanceService,
    logger,
    60, // 60 minutes (once per hour)
  )

  // graceful shutdown
  onShutdown(async () => {
    logger.info('Shutdown')
    pnlCacheService.stop()
    dailyPnLScheduler.stop()
    depositMonitor.stop()
    await serverManager.stop()
  })

  // to prevent receiving updates before the bot is ready
  await bot.init()

  // start server
  const info = await serverManager.start()
  logger.info({
    msg: 'Server started',
    url: info.url,
  })

  // set webhook
  await bot.api.setWebhook(config.botWebhook, {
    allowed_updates: config.botAllowedUpdates,
    secret_token: config.botWebhookSecret,
  })
  logger.info({
    msg: 'Webhook was set',
    url: config.botWebhook,
  })

  // Set bot and wallet service in deposit monitor
  depositMonitor.setBot(bot)
  depositMonitor.setWalletService(walletService)

  // Start monitoring deposits (check every 60 seconds to avoid rate limits)
  try {
    await depositMonitor.start(60000)
    logger.info('Deposit monitor started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start deposit monitor')
    // Don't fail the entire startup if deposit monitor fails
  }

  // Start daily PnL scheduler
  try {
    dailyPnLScheduler.start()
    logger.info('Daily PnL scheduler started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start daily PnL scheduler')
    // Don't fail the entire startup if scheduler fails
  }

  // Start PnL cache service (recalculates PnL hourly)
  try {
    pnlCacheService.start()
    logger.info('PnL cache service started successfully')
  }
  catch (error) {
    logger.error({ error }, 'Failed to start PnL cache service')
    // Don't fail the entire startup if cache service fails
  }

  logger.info({
    msg: 'Bot running...',
    username: bot.botInfo.username,
  })
}

try {
  if (config.isWebhookMode)
    await startWebhook(config)
  else if (config.isPollingMode)
    await startPolling(config)
}
catch (error) {
  logger.error(error)
  process.exit(1)
}

// Utils

function onShutdown(cleanUp: () => Promise<void>) {
  let isShuttingDown = false
  const handleShutdown = async () => {
    if (isShuttingDown) {
      // Force exit if shutdown takes too long
      setTimeout(() => {
        console.error('Forced shutdown after timeout')
        process.exit(1)
      }, 10000)
      return
    }
    isShuttingDown = true

    try {
      await cleanUp()
      process.exit(0)
    }
    catch (error) {
      console.error('Error during shutdown:', error)
      process.exit(1)
    }
  }
  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error)
    handleShutdown()
  })

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason)
    handleShutdown()
  })
}
