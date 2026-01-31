import type { Context } from '#root/bot/context.js'
import type { Config } from '#root/config.js'
import type { Logger } from '#root/logger.js'
import type { BotConfig } from 'grammy'
import { adminTradingFeature } from '#root/bot/features/admin-trading.js'
import { adminFeature } from '#root/bot/features/admin.js'
import { balanceFeature } from '#root/bot/features/balance.js'
import { depositFeature } from '#root/bot/features/deposit.js'
import { groupGreetingFeature } from '#root/bot/features/group-greeting.js'
import { groupsFeature } from '#root/bot/features/groups.js'
import { helpFeature } from '#root/bot/features/help.js'
import { historyFeature } from '#root/bot/features/history.js'
import { languageFeature } from '#root/bot/features/language.js'
import { leaderboardFeature } from '#root/bot/features/leaderboard.js'
import { limitsFeature } from '#root/bot/features/limits.js'
import { membersFeature } from '#root/bot/features/members.js'
import { portfolioFeature } from '#root/bot/features/portfolio.js'
import { privacyFeature } from '#root/bot/features/privacy.js'
import { startFeature } from '#root/bot/features/start.js'
import { tradeFeature } from '#root/bot/features/trade.js'
import { unhandledFeature } from '#root/bot/features/unhandled.js'
import { welcomeFeature } from '#root/bot/features/welcome.js'
import { withdrawFeature } from '#root/bot/features/withdraw.js'
import { errorHandler } from '#root/bot/handlers/error.js'
import { i18n, isMultipleLocales } from '#root/bot/i18n.js'
import { session } from '#root/bot/middlewares/session.js'
import { updateLogger } from '#root/bot/middlewares/update-logger.js'
import { prisma } from '#root/db.js'
import { GroupService } from '#root/services/group.js'
import { createJupiterService } from '#root/services/jupiter-factory.js'
import { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { TokenBalanceService } from '#root/services/token-balance.js'
import { WalletService } from '#root/services/wallet.js'
import { autoChatAction } from '@grammyjs/auto-chat-action'
import { hydrate } from '@grammyjs/hydrate'
import { hydrateReply, parseMode } from '@grammyjs/parse-mode'
import { sequentialize } from '@grammyjs/runner'
import { MemorySessionStorage, Bot as TelegramBot } from 'grammy'

interface Dependencies {
  config: Config
  logger: Logger
}

function getSessionKey(ctx: Omit<Context, 'session'>) {
  return ctx.chat?.id.toString()
}

export function createBot(token: string, dependencies: Dependencies, botConfig?: BotConfig<Context>) {
  const {
    config,
    logger,
  } = dependencies

  const bot = new TelegramBot<Context>(token, botConfig)

  bot.use(async (ctx, next) => {
    ctx.config = config
    ctx.logger = logger.child({
      update_id: ctx.update.update_id,
    })

    await next()
  })

  const protectedBot = bot.errorBoundary(errorHandler)

  // Middlewares
  bot.api.config.use(parseMode('HTML'))

  if (config.isPollingMode)
    protectedBot.use(sequentialize(getSessionKey))
  if (config.isDebug)
    protectedBot.use(updateLogger())
  protectedBot.use(autoChatAction(bot.api))
  protectedBot.use(hydrateReply)
  protectedBot.use(hydrate())
  protectedBot.use(session({
    getSessionKey,
    storage: new MemorySessionStorage(),
  }))
  protectedBot.use(i18n)

  // Initialize services
  // Note: These services are for user-facing commands, so they use the main RPC URL
  // Background jobs (deposit monitor, PnL cache) use separate read-only RPC in main.ts
  // Get singleton rate limiter instance (must be initialized in main.ts first)
  const rateLimiter = RPCRateLimiter.getInstance()
  const walletService = new WalletService(
    config.walletMasterSeed,
    config.walletEncryptionKey,
    config.solanaRpcUrl,
    rateLimiter,
  )
  const groupService = new GroupService(prisma, walletService)
  const jupiterService = createJupiterService(config.solanaRpcUrl, logger)
  // Token balance service for user commands (uses main RPC, not read-only rotation)
  const tokenBalanceService = new TokenBalanceService(config.solanaRpcUrl, rateLimiter, logger)

  // Handlers
  protectedBot.use(groupGreetingFeature())
  protectedBot.use(helpFeature)
  protectedBot.use(startFeature(prisma, groupService))
  protectedBot.use(leaderboardFeature(prisma))
  protectedBot.use(depositFeature(prisma, groupService))
  protectedBot.use(groupsFeature(prisma, groupService, walletService))
  protectedBot.use(balanceFeature(prisma, walletService))
  protectedBot.use(limitsFeature(prisma))
  protectedBot.use(membersFeature(prisma))
  protectedBot.use(privacyFeature(prisma))
  protectedBot.use(historyFeature(prisma, jupiterService, config.solanaRpcUrl))
  protectedBot.use(portfolioFeature(prisma, jupiterService, walletService, tokenBalanceService))
  protectedBot.use(withdrawFeature(prisma, walletService, config.solanaRpcUrl))
  protectedBot.use(tradeFeature(prisma, walletService, jupiterService, config.solanaRpcUrl, tokenBalanceService))
  protectedBot.use(adminTradingFeature(prisma, walletService))
  protectedBot.use(welcomeFeature)
  protectedBot.use(adminFeature)
  if (isMultipleLocales)
    protectedBot.use(languageFeature)

  // must be the last handler
  protectedBot.use(unhandledFeature)

  return bot
}

export type Bot = ReturnType<typeof createBot>
