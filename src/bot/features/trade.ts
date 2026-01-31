import type { Context } from '#root/bot/context.js'
import type { IJupiterService } from '#root/services/jupiter-interface.js'
import type { TokenBalanceService } from '#root/services/token-balance.js'
import type { WalletService } from '#root/services/wallet.js'
import type { QuoteResponse } from '@jup-ag/api'
import type { PrismaClient } from '@prisma/client'
import { config } from '#root/config.js'
import { PnLCacheService } from '#root/services/pnl-cache.js'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { Composer, InlineKeyboard } from 'grammy'

const LAMPORTS_PER_SOL = 1_000_000_000
const MAX_PRICE_IMPACT = 5 // 5% max price impact
const COMMISSION_RATE_BPS = 15 // 0.15% in basis points

/**
 * Check if user is authorized to trade (isTrader OR is group admin)
 */
async function isAuthorizedTrader(
  ctx: Context,
  member: { isTrader: boolean },
): Promise<boolean> {
  // If already a trader, authorized
  if (member.isTrader) {
    return true
  }

  // Check if user is a group admin
  try {
    const chatAdmins = await ctx.getChatAdministrators()
    const isAdmin = chatAdmins.some(admin => admin.user.id === ctx.from?.id)
    return isAdmin
  }
  catch {
    // If we can't get admins, fall back to isTrader only
    return false
  }
}

interface PendingTrade {
  quote: QuoteResponse
  inputToken: string
  outputToken: string
  inputSymbol: string
  outputSymbol: string
  groupId: string
  traderId: string
  tradeType: 'buy' | 'sell'
}

// Store pending trades (in production, use Redis or database)
const pendingTrades = new Map<string, PendingTrade>()

// Store pending risk acknowledgments (token address + amount before user confirms risk)
interface PendingRiskAck {
  outputToken: string
  targetAmount: number
  chatId: string
  userId: string
}
const pendingRiskAcks = new Map<string, PendingRiskAck>()

export function tradeFeature(
  prisma: PrismaClient,
  walletService: WalletService,
  jupiterService: IJupiterService,
  solanaRpcUrl: string,
  tokenBalanceService: TokenBalanceService,
) {
  const composer = new Composer<Context>()

  // Helper function to check trade limits
  async function checkTradeLimits(
    groupId: string,
    userId: string,
    amountLamports: bigint,
  ): Promise<{ allowed: boolean, reason?: string }> {
    const member = await prisma.member.findUnique({
      where: {
        groupId_telegramUserId: {
          groupId,
          telegramUserId: userId,
        },
      },
    })

    if (!member) {
      return { allowed: false, reason: 'Member not found' }
    }

    // Check per-trade limit
    if (member.tradeLimit && amountLamports > member.tradeLimit) {
      const limitSOL = Number(member.tradeLimit) / LAMPORTS_PER_SOL
      return {
        allowed: false,
        reason: `Exceeds your per-trade limit of ${limitSOL.toFixed(4)} SOL`,
      }
    }

    // Check daily limit
    if (member.dailyLimit) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const dailyTrades = await prisma.trade.aggregate({
        where: {
          groupId,
          traderId: member.id,
          executedAt: {
            gte: today,
          },
        },
        _sum: {
          amountIn: true,
        },
      })

      const dailyTotal = BigInt(dailyTrades._sum.amountIn || 0)
      if (dailyTotal + amountLamports > member.dailyLimit) {
        const limitSOL = Number(member.dailyLimit) / LAMPORTS_PER_SOL
        const usedSOL = Number(dailyTotal) / LAMPORTS_PER_SOL
        return {
          allowed: false,
          reason: `Would exceed your daily limit of ${limitSOL.toFixed(4)} SOL (used: ${usedSOL.toFixed(4)} SOL today)`,
        }
      }
    }

    return { allowed: true }
  }

  // /buy command
  composer.command('buy', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /buy command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()
    const userId = ctx.from?.id.toString()

    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

    // Parse command arguments: /buy <token> <target_amount>
    const args = ctx.match?.toString().trim().split(/\s+/) || []

    if (args.length < 2) {
      const helpMessage = `💰 <b>Buy Tokens</b>

<b>Usage:</b>
<code>/buy &lt;token&gt; &lt;target_amount&gt;</code>

<b>Examples:</b>
• <code>/buy USDC 1</code> - Buy exactly 1 USDC
• <code>/buy BONK 1000000</code> - Buy exactly 1,000,000 BONK
• <code>/buy JUP 10</code> - Buy exactly 10 JUP
• <code>/buy &lt;contract_address&gt; 100</code> - Buy by contract address

<b>Supported tokens:</b>
${Object.keys(jupiterService.COMMON_TOKENS).join(', ')}

<b>Note:</b> 
• Amount is the target token amount you want to receive
• You can use token symbols or contract addresses
• ⚠️ Unverified tokens will show a risk warning`

      return ctx.reply(helpMessage, {
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }

    const [tokenInput, targetAmountInput] = args
    const targetAmount = Number.parseFloat(targetAmountInput)

    if (Number.isNaN(targetAmount) || targetAmount <= 0) {
      return ctx.reply('❌ Invalid target amount. Please provide a valid number.')
    }

    try {
      // Get group and member info
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
        include: { members: true },
      })

      if (!group) {
        return ctx.reply('❌ Group not initialized. Use /start to initialize the group.')
      }

      const member = group.members.find(m => m.telegramUserId === userId)
      if (!member) {
        return ctx.reply('❌ You are not a member of this group.')
      }

      // Check if user is authorized (trader OR admin)
      const canTrade = await isAuthorizedTrader(ctx, member)
      if (!canTrade) {
        return ctx.reply('❌ You are not authorized to trade. Ask an admin to run /add_trader.')
      }

      if (group.isPaused) {
        return ctx.reply('❌ Trading is currently paused.')
      }

      // Resolve token address
      let outputToken: string
      try {
        outputToken = jupiterService.resolveTokenAddress(tokenInput)
      }
      catch (error) {
        return ctx.reply(`❌ ${error instanceof Error ? error.message : `Invalid token: ${tokenInput}`}`)
      }

      // Get token info to convert target amount to lamports
      const outputTokenInfo = await jupiterService.getTokenInfo(outputToken)
      if (!outputTokenInfo) {
        return ctx.reply(`❌ Could not get token information for ${tokenInput}`)
      }

      // Check if token is in whitelist (COMMON_TOKENS)
      const isWhitelisted = Object.values(jupiterService.COMMON_TOKENS).includes(outputToken)

      // For non-whitelisted tokens, check risk and show warning
      let riskInfo: Awaited<ReturnType<typeof jupiterService.getTokenRiskInfo>> | null = null
      if (!isWhitelisted) {
        riskInfo = await jupiterService.getTokenRiskInfo(outputToken)

        // Build warning message for unverified tokens
        const riskWarnings: string[] = []
        if (!riskInfo.isVerified) {
          riskWarnings.push('⚠️ This token is NOT verified by Jupiter')
        }
        if (!riskInfo.isTradable) {
          riskWarnings.push('⚠️ This token may have low or no liquidity')
        }
        if (riskInfo.hasFreezeAuthority === true) {
          riskWarnings.push('⚠️ Token has freeze authority (can freeze your tokens)')
        }
        if (riskInfo.mintAuthorityRevoked === false) {
          riskWarnings.push('⚠️ Mint authority not revoked (more tokens can be minted)')
        }

        if (riskWarnings.length > 0) {
          // Store pending risk acknowledgment with short ID (Telegram callback_data has 64 byte limit)
          const riskAckId = `${chatId}:${userId}:${Date.now()}`
          pendingRiskAcks.set(riskAckId, {
            outputToken,
            targetAmount,
            chatId,
            userId,
          })

          // Auto-expire after 5 minutes
          setTimeout(() => {
            pendingRiskAcks.delete(riskAckId)
          }, 5 * 60 * 1000)

          const warningMessage = `🚨 <b>${ctx.t('trade-warning-unverified')}</b>

<b>Token:</b> ${outputTokenInfo.name} (${outputTokenInfo.symbol})
<b>Address:</b> <code>${outputToken}</code>

${riskWarnings.join('\n')}

<b>⚠️ ${ctx.t('trade-warning-risks')}</b>
• ${ctx.t('trade-warning-honeypot')}
• ${ctx.t('trade-warning-rugpull')}
• ${ctx.t('trade-warning-taxes')}
• ${ctx.t('trade-warning-liquidity')}
• ${ctx.t('trade-warning-audit')}

<b>⚠️ ${ctx.t('trade-warning-own-risk')}</b>

${ctx.t('trade-confirm-risky')}`

          const warningKeyboard = new InlineKeyboard()
            .text(`⚠️ ${ctx.t('trade-acknowledge-risk')}`, `risk:ack:${riskAckId}`)
            .text(`❌ ${ctx.t('trade-cancel-warning')}`, `risk:cancel:${riskAckId}`)

          return ctx.reply(warningMessage, {
            parse_mode: 'HTML',
            reply_markup: warningKeyboard,
            reply_parameters: { message_id: ctx.msg.message_id },
          })
        }
      }

      // Use a simple approach: get a quote for 1 SOL to see how much USDC we get
      // Then calculate how much SOL we need for the target amount
      const oneSOL = LAMPORTS_PER_SOL

      const initialQuote = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        outputToken,
        oneSOL,
        50, // 0.5% slippage
      )

      if (!initialQuote) {
        return ctx.reply('❌ Could not get quote for this trade.')
      }

      // Calculate how much USDC we get for 1 SOL
      const usdcPerSOL = Number(initialQuote.outAmount) / 10 ** outputTokenInfo.decimals

      // Calculate how much SOL we need for the target amount
      const solNeeded = targetAmount / usdcPerSOL

      // Check if group has enough SOL balance
      // Use the wallet address from the database, not derive a new one
      ctx.logger.debug({
        groupId: group.id,
        groupWalletAddress: group.walletAddress,
      }, 'Checking group wallet balance')

      const solBalance = await walletService.getBalance(group.walletAddress)
      const solBalanceFormatted = Number(solBalance) / LAMPORTS_PER_SOL

      ctx.logger.debug({
        groupWalletAddress: group.walletAddress,
        solBalance: solBalance.toString(),
        solBalanceFormatted,
        solNeeded,
      }, 'Group wallet balance check')

      if (solBalance < BigInt(Math.floor(solNeeded * LAMPORTS_PER_SOL))) {
        return ctx.reply(
          `❌ Insufficient SOL balance. Need ${solNeeded.toFixed(4)} SOL, have ${solBalanceFormatted.toFixed(4)} SOL.`,
        )
      }

      // Check trading limits
      const limitCheck = await checkTradeLimits(group.id, userId, BigInt(Math.floor(solNeeded * LAMPORTS_PER_SOL)))
      if (!limitCheck.allowed) {
        return ctx.reply(`❌ ${limitCheck.reason}`)
      }

      // Get forward quote (SOL -> token) for confirmation
      const forwardQuote = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        outputToken,
        Math.floor(solNeeded * LAMPORTS_PER_SOL),
        50, // 0.5% slippage
      )

      if (!forwardQuote) {
        return ctx.reply('❌ Could not get confirmation quote.')
      }

      // Check price impact
      const priceImpact = jupiterService.calculatePriceImpact(forwardQuote)
      if (!jupiterService.isPriceImpactAcceptable(forwardQuote, MAX_PRICE_IMPACT)) {
        return ctx.reply(
          `⚠️ High Price Impact\n\nPrice impact: ${Math.abs(priceImpact).toFixed(2)}%\n\nThis trade would have a significant price impact. Consider reducing the amount.`,
        )
      }

      // Format amounts for display
      const outputAmount = BigInt(forwardQuote.outAmount)
      const outputAmountFormatted = jupiterService.formatTokenAmount(
        outputAmount.toString(),
        outputTokenInfo.decimals,
      )

      const confirmMessage = `💰 <b>Confirm Buy Order</b>

<b>Target:</b> ${targetAmount} ${outputTokenInfo.symbol}
<b>Spending:</b> ~${solNeeded.toFixed(4)} SOL
<b>Receiving:</b> ~${outputAmountFormatted} ${outputTokenInfo.symbol}
<b>Price Impact:</b> ${Math.abs(priceImpact).toFixed(2)}%
<b>Slippage:</b> 0.5%

<b>Route:</b> SOL → ${outputTokenInfo.symbol}

Do you want to execute this trade?`

      // Store pending trade
      const tradeId = `${chatId}:${userId}:${Date.now()}`
      pendingTrades.set(tradeId, {
        quote: forwardQuote,
        inputToken: 'So11111111111111111111111111111111111111112',
        outputToken,
        inputSymbol: 'SOL',
        outputSymbol: outputTokenInfo.symbol,
        groupId: group.id,
        traderId: userId,
        tradeType: 'buy',
      })

      // Create inline keyboard
      const keyboard = new InlineKeyboard()
        .text('✅ Execute', `trade:execute:${tradeId}`)
        .text('❌ Cancel', `trade:cancel:${tradeId}`)

      await ctx.reply(confirmMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        reply_parameters: { message_id: ctx.msg.message_id },
      })

      // Auto-expire after 5 minutes
      setTimeout(() => {
        pendingTrades.delete(tradeId)
      }, 5 * 60 * 1000)
    }
    catch (error) {
      ctx.logger.error({ error, userId }, 'Buy command failed')
      await ctx.reply(`❌ Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  })

  // /sell command
  composer.command('sell', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /sell command is only available in group chats.')
    }

    const userId = ctx.from?.id.toString()

    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

    // Parse command arguments: /sell <token> <amount_or_percentage>
    const args = ctx.match?.toString().trim().split(/\s+/) || []

    if (args.length < 2) {
      const helpMessage = `💰 <b>Sell Tokens</b>

<b>Usage:</b>
<code>/sell &lt;token&gt; &lt;amount|percentage&gt;</code>
<code>/sell &lt;amount|percentage&gt; &lt;token&gt;</code>

<b>Examples:</b>
• <code>/sell BONK 1000000</code> - Sell 1M BONK
• <code>/sell USDC 50%</code> - Sell 50% of USDC holdings
• <code>/sell JUP all</code> - Sell all JUP tokens
• <code>/sell all BONK</code> - Sell all BONK tokens (alternative order)

<b>Note:</b> Arguments can be in either order. Use token amount or percentage/all of holdings.`

      return ctx.reply(helpMessage, {
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }

    const [arg1, arg2] = args

    // Smart parsing: detect which arg is token vs amount
    let tokenSymbol: string
    let amountStr: string

    // Check if arg1 is an amount indicator (all, percentage, or numeric)
    const isArg1Amount = arg1.toLowerCase() === 'all'
      || arg1.endsWith('%')
      || !Number.isNaN(Number.parseFloat(arg1))

    // Check if arg2 is an amount indicator
    const isArg2Amount = arg2.toLowerCase() === 'all'
      || arg2.endsWith('%')
      || !Number.isNaN(Number.parseFloat(arg2))

    if (isArg1Amount && !isArg2Amount) {
      // Pattern: /sell all bonk OR /sell 50% bonk
      amountStr = arg1
      tokenSymbol = arg2
    }
    else {
      // Default pattern: /sell bonk all OR /sell bonk 50%
      tokenSymbol = arg1
      amountStr = arg2
    }

    try {
      // Check if group is initialized
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: ctx.chat.id.toString() },
      })

      if (!group) {
        return ctx.reply(
          'This group has not been initialized yet. Use /init to set up the trading group.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Check if user is a member
      const member = await prisma.member.findUnique({
        where: {
          groupId_telegramUserId: {
            groupId: group.id,
            telegramUserId: userId,
          },
        },
      })

      if (!member) {
        return ctx.reply(
          'You are not a member of this group. Use /deposit to join.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Check if user is authorized (trader OR admin)
      const canTrade = await isAuthorizedTrader(ctx, member)
      if (!canTrade) {
        return ctx.reply(
          'You do not have trading permission. Ask an admin to run /add_trader.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Check if trading is paused
      if (group.isPaused) {
        return ctx.reply(
          'Trading is currently paused. Contact an admin to resume trading.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Resolve token address - try direct resolution first
      let tokenAddress: string | null = null
      try {
        tokenAddress = jupiterService.resolveTokenAddress(tokenSymbol)
      }
      catch {
        // If direct resolution fails, search positions by symbol
        const positions = await prisma.position.findMany({
          where: { groupId: group.id },
        })

        // Search through positions to find matching symbol
        for (const pos of positions) {
          const tokenInfo = await jupiterService.getTokenInfo(pos.tokenAddress)
          if (tokenInfo && tokenInfo.symbol.toUpperCase() === tokenSymbol.toUpperCase()) {
            tokenAddress = pos.tokenAddress
            break
          }
        }

        // If still not found, try case-insensitive partial match
        if (!tokenAddress) {
          for (const pos of positions) {
            const tokenInfo = await jupiterService.getTokenInfo(pos.tokenAddress)
            if (tokenInfo && tokenInfo.symbol.toUpperCase().includes(tokenSymbol.toUpperCase())) {
              tokenAddress = pos.tokenAddress
              break
            }
          }
        }
      }

      if (!tokenAddress) {
        return ctx.reply(
          `Unknown token: ${tokenSymbol}. Please use a valid token symbol or address. Use /portfolio to see your holdings.`,
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Get user's position for this token
      const position = await prisma.position.findUnique({
        where: {
          groupId_tokenAddress: {
            groupId: group.id,
            tokenAddress,
          },
        },
      })

      // Get on-chain balance using the actual group wallet address from database
      const tokenBalance = await tokenBalanceService.getTokenBalance(
        group.walletAddress,
        tokenAddress,
      )

      // Check if user has any position or balance
      if (!position && tokenBalance.amount === BigInt(0)) {
        return ctx.reply(
          `You have no position in ${tokenSymbol}. Use /portfolio to see your holdings.`,
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Parse amount
      let sellAmount: bigint

      if (amountStr.toLowerCase() === 'all') {
        sellAmount = tokenBalance.amount
      }
      else if (amountStr.endsWith('%')) {
        const percentage = Number.parseFloat(amountStr.slice(0, -1))
        if (Number.isNaN(percentage) || percentage <= 0 || percentage > 100) {
          return ctx.reply(
            'Invalid percentage. Please use a value between 1% and 100%.',
            {
              reply_parameters: { message_id: ctx.msg.message_id },
            },
          )
        }
        sellAmount = (tokenBalance.amount * BigInt(Math.floor(percentage * 100))) / BigInt(10000)
      }
      else {
        const amount = Number.parseFloat(amountStr)
        if (Number.isNaN(amount) || amount <= 0) {
          return ctx.reply(
            'Invalid amount. Please use a positive number, percentage, or "all".',
            {
              reply_parameters: { message_id: ctx.msg.message_id },
            },
          )
        }

        // Convert amount to token units based on decimals
        const decimals = tokenBalance.decimals
        sellAmount = BigInt(Math.floor(amount * 10 ** decimals))
      }

      // Get token info for display (needed for symbol and error messages)
      const tokenInfo = await jupiterService.getTokenInfo(tokenAddress)
      if (!tokenInfo) {
        return ctx.reply(
          'Failed to get token information. Please try again.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Use resolved token symbol for display
      const displaySymbol = tokenInfo.symbol || tokenSymbol

      // Check if user has sufficient balance
      if (sellAmount > tokenBalance.amount) {
        const balanceFormatted = jupiterService.formatTokenAmount(
          tokenBalance.amount.toString(),
          tokenBalance.decimals,
        )
        return ctx.reply(
          `Insufficient balance. You have ${balanceFormatted} ${displaySymbol}.`,
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Get quote (token -> SOL)
      const quote = await jupiterService.getQuote(
        tokenAddress,
        'So11111111111111111111111111111111111111112', // SOL
        Number(sellAmount),
        50, // 0.5% slippage
      )

      if (!quote) {
        return ctx.reply(
          'Failed to get quote. Please try again.',
          {
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Format amounts for display
      const outputAmount = BigInt(quote.outAmount)
      const sellAmountFormatted = jupiterService.formatTokenAmount(
        sellAmount.toString(),
        tokenInfo.decimals,
      )
      const solAmount = Number(outputAmount) / LAMPORTS_PER_SOL

      // Calculate and format price impact
      const priceImpact = jupiterService.calculatePriceImpact(quote)

      // Create confirmation message
      const confirmationMessage = `💰 <b>Sell ${sellAmountFormatted} ${tokenInfo.symbol}</b>

<b>You will receive:</b> ${solAmount.toFixed(6)} SOL
<b>Price impact:</b> ${Math.abs(priceImpact).toFixed(4)}%

<b>Confirm this trade?</b>`

      // Store pending trade - use the same format as /buy command
      const tradeId = `${ctx.chat.id}:${userId}:${Date.now()}`
      pendingTrades.set(tradeId, {
        quote,
        inputToken: tokenAddress,
        outputToken: 'So11111111111111111111111111111111111111112',
        inputSymbol: tokenInfo.symbol,
        outputSymbol: 'SOL',
        groupId: group.id,
        traderId: userId,
        tradeType: 'sell',
      })

      const keyboard = new InlineKeyboard()
        .text('✅ Confirm Sell', `trade:execute:${tradeId}`)
        .text('❌ Cancel', `trade:cancel:${tradeId}`)

      await ctx.reply(confirmationMessage, {
        reply_markup: keyboard,
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    catch (error) {
      ctx.logger.error(
        {
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          userId,
          tokenSymbol,
          amountStr,
        },
        'Sell command failed',
      )
      await ctx.reply(
        'An error occurred while processing your sell request. Please try again.',
        {
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      )
    }
  })

  // Handle risk acknowledgment callback (for unverified tokens)
  composer.callbackQuery(/^risk:ack:(.+)$/, async (ctx) => {
    const riskAckId = ctx.match[1]

    // Look up pending risk acknowledgment
    const pendingRisk = pendingRiskAcks.get(riskAckId)
    if (!pendingRisk) {
      await ctx.answerCallbackQuery({ text: '❌ This request has expired' })
      return
    }

    const { outputToken, targetAmount, chatId, userId } = pendingRisk

    // Verify user is the one who initiated
    if (ctx.from?.id.toString() !== userId) {
      await ctx.answerCallbackQuery({ text: '❌ Only the requester can confirm' })
      return
    }

    // Clean up the pending risk ack
    pendingRiskAcks.delete(riskAckId)

    try {
      // Get group and member info
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
        include: { members: true },
      })

      if (!group) {
        await ctx.answerCallbackQuery({ text: '❌ Group not initialized' })
        return
      }

      const member = group.members.find(m => m.telegramUserId === userId)
      if (!member) {
        await ctx.answerCallbackQuery({ text: '❌ You are not a member' })
        return
      }

      // Check if user is authorized (trader OR admin)
      const canTrade = await isAuthorizedTrader(ctx, member)
      if (!canTrade) {
        await ctx.answerCallbackQuery({ text: '❌ Not authorized to trade' })
        return
      }

      if (group.isPaused) {
        await ctx.answerCallbackQuery({ text: '❌ Trading is paused' })
        return
      }

      // Get token info
      const outputTokenInfo = await jupiterService.getTokenInfo(outputToken)
      if (!outputTokenInfo) {
        await ctx.answerCallbackQuery({ text: '❌ Could not get token info' })
        return
      }

      // Get quote to calculate SOL needed
      const oneSOL = LAMPORTS_PER_SOL
      const initialQuote = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        outputToken,
        oneSOL,
        50, // 0.5% slippage
      )

      if (!initialQuote) {
        await ctx.answerCallbackQuery({ text: '❌ Could not get quote' })
        return
      }

      const tokensPerSOL = Number(initialQuote.outAmount) / 10 ** outputTokenInfo.decimals
      const solNeeded = targetAmount / tokensPerSOL

      // Check balance
      const solBalance = await walletService.getBalance(group.walletAddress)
      if (solBalance < BigInt(Math.floor(solNeeded * LAMPORTS_PER_SOL))) {
        await ctx.answerCallbackQuery({ text: '❌ Insufficient balance' })
        return
      }

      // Check trading limits
      const limitCheck = await checkTradeLimits(group.id, userId, BigInt(Math.floor(solNeeded * LAMPORTS_PER_SOL)))
      if (!limitCheck.allowed) {
        await ctx.answerCallbackQuery({ text: `❌ ${limitCheck.reason}` })
        return
      }

      // Get forward quote for confirmation
      const forwardQuote = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        outputToken,
        Math.floor(solNeeded * LAMPORTS_PER_SOL),
        50, // 0.5% slippage
      )

      if (!forwardQuote) {
        await ctx.answerCallbackQuery({ text: '❌ Could not get confirmation quote' })
        return
      }

      // Check price impact
      const priceImpact = jupiterService.calculatePriceImpact(forwardQuote)
      if (!jupiterService.isPriceImpactAcceptable(forwardQuote, MAX_PRICE_IMPACT)) {
        await ctx.answerCallbackQuery({
          text: `⚠️ High price impact: ${Math.abs(priceImpact).toFixed(2)}%`,
        })
        return
      }

      // Format amounts for display
      const outputAmount = BigInt(forwardQuote.outAmount)
      const outputAmountFormatted = jupiterService.formatTokenAmount(
        outputAmount.toString(),
        outputTokenInfo.decimals,
      )

      const confirmMessage = `💰 <b>Confirm Buy Order</b>

<b>Target:</b> ${targetAmount} ${outputTokenInfo.symbol}
<b>Spending:</b> ~${solNeeded.toFixed(4)} SOL
<b>Receiving:</b> ~${outputAmountFormatted} ${outputTokenInfo.symbol}
<b>Price Impact:</b> ${Math.abs(priceImpact).toFixed(2)}%
<b>Slippage:</b> 0.5%

<b>Route:</b> SOL → ${outputTokenInfo.symbol}

⚠️ <b>Unverified Token</b> - Trading at your own risk!

Do you want to execute this trade?`

      // Store pending trade
      const tradeId = `${chatId}:${userId}:${Date.now()}`
      pendingTrades.set(tradeId, {
        quote: forwardQuote,
        inputToken: 'So11111111111111111111111111111111111111112',
        outputToken,
        inputSymbol: 'SOL',
        outputSymbol: outputTokenInfo.symbol,
        groupId: group.id,
        traderId: userId,
        tradeType: 'buy',
      })

      // Create inline keyboard
      const keyboard = new InlineKeyboard()
        .text('✅ Execute', `trade:execute:${tradeId}`)
        .text('❌ Cancel', `trade:cancel:${tradeId}`)

      await ctx.answerCallbackQuery({ text: '✅ Risk acknowledged' })
      await ctx.editMessageText(confirmMessage, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })

      // Auto-expire after 5 minutes
      setTimeout(() => {
        pendingTrades.delete(tradeId)
      }, 5 * 60 * 1000)
    }
    catch (error) {
      ctx.logger.error({ error, userId }, 'Risk acknowledgment failed')
      await ctx.answerCallbackQuery({ text: '❌ Error processing request' })
    }
  })

  // Handle cancel warning callback
  composer.callbackQuery(/^risk:cancel:(.+)$/, async (ctx) => {
    const riskAckId = ctx.match[1]
    pendingRiskAcks.delete(riskAckId) // Clean up
    await ctx.answerCallbackQuery({ text: '✅ Cancelled' })
    await ctx.editMessageText('❌ Trade cancelled. Use /buy to start a new trade.')
  })

  // Handle trade confirmation callbacks
  composer.callbackQuery(/^trade:(execute|cancel):(.+)$/, async (ctx) => {
    console.warn('callbackQuery', ctx.match)
    const action = ctx.match[1]
    const tradeId = ctx.match[2]

    // Check if trade exists
    const pendingTrade = pendingTrades.get(tradeId)
    if (!pendingTrade) {
      await ctx.answerCallbackQuery({
        text: '❌ This trade has expired or been cancelled.',
      })
      return
    }

    // Verify user is the one who initiated the trade
    const userId = ctx.from?.id.toString()
    if (userId !== pendingTrade.traderId) {
      await ctx.answerCallbackQuery({
        text: '❌ Only the trader who initiated this can confirm.',
      })
      return
    }

    if (action === 'cancel') {
      pendingTrades.delete(tradeId)
      await ctx.answerCallbackQuery({ text: '✅ Trade cancelled' })
      await ctx.editMessageText('❌ Trade cancelled by user.')
      return
    }

    // Answer callback query IMMEDIATELY (Telegram has a timeout)
    // Use try-catch to ignore errors if it's already been answered or expired
    try {
      await ctx.answerCallbackQuery({ text: '⏳ Executing trade...' })
    }
    catch (error: any) {
      // Ignore callback query errors (might be expired or already answered)
      ctx.logger?.debug({ error }, 'Callback query answer failed (likely expired)')
    }

    // Send processing message based on trade type
    const processingMessage = pendingTrade.tradeType === 'buy'
      ? `🔄 <b>Processing Buy Order...</b>

Trader: ${ctx.from?.username ? `@${ctx.from.username}` : 'User'}
Token: ${pendingTrade.outputSymbol}
Amount: ${Number(pendingTrade.quote.inAmount) / LAMPORTS_PER_SOL} SOL

⏳ Waiting for confirmation...`
      : `🔄 <b>Processing Sell Order...</b>

Trader: ${ctx.from?.username ? `@${ctx.from.username}` : 'User'}
Token: ${pendingTrade.inputSymbol}
Amount: ${jupiterService.formatTokenAmount(
  pendingTrade.quote.inAmount,
  (await jupiterService.getTokenInfo(pendingTrade.inputToken))?.decimals || 9,
)} ${pendingTrade.inputSymbol}

⏳ Waiting for confirmation...`

    // Only edit message if content actually changed (avoid "message not modified" error)
    try {
      await ctx.editMessageText(processingMessage, {
        parse_mode: 'HTML',
      })
    }
    catch (error: any) {
      // Ignore "message not modified" errors (user clicked multiple times)
      if (error?.error_code !== 400 || !error?.description?.includes('message is not modified')) {
        ctx.logger?.warn({ error }, 'Failed to edit message, continuing anyway')
      }
    }

    try {
      // Get group wallet
      const groupWalletData = await prisma.group.findUnique({
        where: { id: pendingTrade.groupId },
      })

      if (!groupWalletData) {
        throw new Error('Group not found')
      }

      const groupWallet = walletService.restoreWallet(
        groupWalletData.encryptedPrivateKey,
        groupWalletData.encryptionIv,
      )

      // Execute swap without fee account (normal trading)
      const swapTransaction = await jupiterService.executeSwap(
        pendingTrade.quote,
        groupWallet.publicKey,
      )

      const txid = await jupiterService.sendSwapTransaction(
        swapTransaction,
        groupWallet,
      )

      // Handle commission for sell trades
      let feeAmount = 0n
      let feeTxid: string | undefined
      if (
        pendingTrade.tradeType === 'sell'
        && config.operatorFeeWalletAddress
      ) {
        const outputAmount = BigInt(pendingTrade.quote.outAmount)
        feeAmount = (outputAmount * BigInt(COMMISSION_RATE_BPS)) / 10000n

        if (feeAmount > 0n) {
          try {
            // Check wallet balance before attempting commission transfer
            const connection = (jupiterService as any).connection
            const walletBalance = await connection.getBalance(groupWallet.publicKey)

            // Constants for rent and fee calculation
            const RENT_EXEMPTION = 890880n // ~0.0009 SOL minimum for account
            const TX_FEE = 5000n // ~0.000005 SOL typical transaction fee

            // Check if operator wallet exists on-chain
            const operatorPubkey = new PublicKey(config.operatorFeeWalletAddress)
            const operatorAccountInfo = await connection.getAccountInfo(operatorPubkey)
            const operatorAccountExists = operatorAccountInfo !== null

            // If operator account doesn't exist, we need to send at least rent-exempt minimum
            const minTransferAmount = operatorAccountExists ? 0n : RENT_EXEMPTION
            const actualTransferAmount = feeAmount > minTransferAmount ? feeAmount : minTransferAmount

            const MIN_BALANCE_FOR_COMMISSION = RENT_EXEMPTION + TX_FEE
            const requiredBalance = MIN_BALANCE_FOR_COMMISSION + actualTransferAmount

            // Skip commission transfer if insufficient balance
            if (BigInt(walletBalance) < requiredBalance) {
              ctx.logger?.warn(
                {
                  walletBalance,
                  requiredBalance: requiredBalance.toString(),
                  feeAmount: feeAmount.toString(),
                  actualTransferAmount: actualTransferAmount.toString(),
                  operatorAccountExists,
                  groupId: pendingTrade.groupId,
                },
                'Insufficient balance for commission transfer (would violate rent-exempt minimum), skipping commission',
              )
            }
            else {
              // Create fee transfer transaction
              const feeTx = new Transaction().add(
                SystemProgram.transfer({
                  fromPubkey: groupWallet.publicKey,
                  toPubkey: operatorPubkey,
                  lamports: actualTransferAmount,
                }),
              )

              // Get recent blockhash and sign
              const { blockhash } = await connection.getLatestBlockhash()
              feeTx.recentBlockhash = blockhash
              feeTx.feePayer = groupWallet.publicKey
              feeTx.sign(groupWallet)

              // Send fee transaction
              feeTxid = await connection.sendRawTransaction(feeTx.serialize())
              await connection.confirmTransaction(feeTxid, 'confirmed')

              // Record commission
              await prisma.commission.create({
                data: {
                  type: 'sell',
                  amountIn: outputAmount,
                  feeAmount: actualTransferAmount, // Record actual amount sent (may be higher than calculated fee)
                  rateBps: COMMISSION_RATE_BPS,
                  operatorWallet: config.operatorFeeWalletAddress,
                  transactionSignature: feeTxid,
                  linkedSignature: txid,
                  groupId: pendingTrade.groupId,
                },
              })

              // Log if we sent more than the calculated fee (to cover rent)
              if (actualTransferAmount > feeAmount) {
                ctx.logger?.info(
                  {
                    feeAmount: feeAmount.toString(),
                    actualTransferAmount: actualTransferAmount.toString(),
                    groupId: pendingTrade.groupId,
                  },
                  'Sent rent-exempt minimum to create operator account (higher than calculated commission)',
                )
              }
            }
          }
          catch (error) {
            ctx.logger?.error({ error }, 'Failed to transfer commission, continuing anyway')
          }
        }
      }

      // Get member
      const member = await prisma.member.findUnique({
        where: {
          groupId_telegramUserId: {
            groupId: pendingTrade.groupId,
            telegramUserId: pendingTrade.traderId,
          },
        },
      })

      if (!member) {
        throw new Error('Member not found')
      }

      const outputAmount = BigInt(pendingTrade.quote.outAmount)

      // Record trade in database
      await prisma.trade.create({
        data: {
          groupId: pendingTrade.groupId,
          traderId: member.id,
          transactionSignature: txid,
          tradeType: pendingTrade.tradeType,
          tokenAddress: pendingTrade.outputToken,
          amountIn: BigInt(pendingTrade.quote.inAmount),
          amountOut: outputAmount,
          tokenIn: pendingTrade.inputToken,
          tokenOut: pendingTrade.outputToken,
          executedAt: new Date(),
        },
      })

      // Invalidate PnL cache for this group (trade affects PnL)
      const pnlCacheService = PnLCacheService.getInstance()
      if (pnlCacheService) {
        await pnlCacheService.invalidateCache(pendingTrade.groupId).catch((error: any) => {
          ctx.logger?.warn({ error, groupId: pendingTrade.groupId }, 'Failed to invalidate PnL cache')
        })
      }

      // Update or create position
      if (pendingTrade.tradeType === 'buy') {
        // Buy: Add tokens to position
        const existingPosition = await prisma.position.findUnique({
          where: {
            groupId_tokenAddress: {
              groupId: pendingTrade.groupId,
              tokenAddress: pendingTrade.outputToken,
            },
          },
        })

        if (existingPosition) {
          await prisma.position.update({
            where: { id: existingPosition.id },
            data: {
              balance: existingPosition.balance + outputAmount,
              costBasis: existingPosition.costBasis + BigInt(pendingTrade.quote.inAmount),
            },
          })
        }
        else {
          await prisma.position.create({
            data: {
              groupId: pendingTrade.groupId,
              tokenAddress: pendingTrade.outputToken,
              balance: outputAmount,
              costBasis: BigInt(pendingTrade.quote.inAmount),
            },
          })
        }
      }
      else {
        // Sell: Reduce the input token position
        // The output is SOL, so we need to find the input token position
        const inputPosition = await prisma.position.findUnique({
          where: {
            groupId_tokenAddress: {
              groupId: pendingTrade.groupId,
              tokenAddress: pendingTrade.inputToken,
            },
          },
        })

        if (inputPosition) {
          const amountToDeduct = BigInt(pendingTrade.quote.inAmount)
          const newBalance = inputPosition.balance > amountToDeduct
            ? inputPosition.balance - amountToDeduct
            : BigInt(0)
          await prisma.position.update({
            where: { id: inputPosition.id },
            data: {
              balance: newBalance,
            },
          })
        }
      }

      // Clean up
      pendingTrades.delete(tradeId)

      // Send success message
      const explorerUrl = solanaRpcUrl.includes('devnet')
        ? `https://explorer.solana.com/tx/${txid}?cluster=devnet`
        : `https://explorer.solana.com/tx/${txid}`

      // Get token decimals for correct formatting
      const tokenInfo = await jupiterService.getTokenInfo(pendingTrade.outputToken)
      const decimals = tokenInfo?.decimals || 9

      // Format amounts for display
      const outputAmountFormatted = jupiterService.formatTokenAmount(
        outputAmount.toString(),
        decimals,
      )

      // Format input amount based on trade type
      const inputTokenInfo = await jupiterService.getTokenInfo(pendingTrade.inputToken)
      const inputDecimals = inputTokenInfo?.decimals || 9
      const inputAmount = jupiterService.formatTokenAmount(
        pendingTrade.quote.inAmount,
        inputDecimals,
      )

      // Different messages for buy vs sell
      let successMessage: string
      if (pendingTrade.tradeType === 'buy') {
        successMessage = `✅ <b>Trade Completed!</b>

Bought: <b>${outputAmountFormatted} ${pendingTrade.outputSymbol}</b>
Cost: <b>${(Number(pendingTrade.quote.inAmount) / LAMPORTS_PER_SOL).toFixed(5)} SOL</b>
Transaction: <a href="${explorerUrl}">${txid.slice(0, 8)}...${txid.slice(-8)}</a>

Use <code>/portfolio</code> for detailed holdings!`
      }
      else {
        // Sell message with commission info
        const netAmount = outputAmount - feeAmount
        const netAmountFormatted = jupiterService.formatTokenAmount(
          netAmount.toString(),
          decimals,
        )

        let message = `✅ <b>Trade Completed!</b>

Sold: <b>${inputAmount} ${pendingTrade.inputSymbol}</b>
Received: <b>${netAmountFormatted} ${pendingTrade.outputSymbol}</b>`

        if (feeAmount > 0n) {
          const solFee = (Number(feeAmount) / LAMPORTS_PER_SOL).toFixed(6)
          message += `

Commission (0.15%): <b>${solFee} SOL</b> → Operator`
        }

        message += `

Transaction: <a href="${explorerUrl}">${txid.slice(0, 8)}...${txid.slice(-8)}</a>

Use <code>/portfolio</code> for detailed holdings!`

        successMessage = message
      }

      try {
        await ctx.editMessageText(successMessage, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        })
      }
      catch (error: any) {
        // Ignore "message not modified" errors
        if (error?.error_code !== 400 || !error?.description?.includes('message is not modified')) {
          ctx.logger?.warn({ error }, 'Failed to edit success message')
          // Try to send as new message if edit fails
          await ctx.reply(successMessage, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          }).catch((replyError) => {
            ctx.logger?.error({ error: replyError }, 'Failed to send success message')
          })
        }
      }
    }
    catch (error) {
      ctx.logger.error({ error, tradeId }, 'Trade execution failed')
      pendingTrades.delete(tradeId)

      try {
        await ctx.editMessageText(
          `❌ <b>Trade Failed</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
          { parse_mode: 'HTML' },
        )
      }
      catch (editError: any) {
        // If edit fails, try to send as new message
        ctx.logger?.warn({ error: editError }, 'Failed to edit error message, sending as new message')
        await ctx.reply(
          `❌ <b>Trade Failed</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`,
          { parse_mode: 'HTML' },
        ).catch((replyError) => {
          ctx.logger?.error({ error: replyError }, 'Failed to send error message')
        })
      }
    }
  })

  return composer
}
