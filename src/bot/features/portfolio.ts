import type { Context } from '#root/bot/context.js'
import type { IJupiterService } from '#root/services/jupiter-interface.js'
import type { TokenBalanceService } from '#root/services/token-balance.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

const LAMPORTS_PER_SOL = 1_000_000_000

function formatSOL(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(4)
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals)
  const whole = amount / divisor
  const fractional = amount % divisor
  const fractionalStr = fractional.toString().padStart(decimals, '0')
  return `${whole}.${fractionalStr}`
}

function formatUSD(amount: number): string {
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`
  }
  else if (amount >= 0.01) {
    return `$${amount.toFixed(4)}`
  }
  else {
    return `$${amount.toFixed(6)}`
  }
}

export function portfolioFeature(
  prisma: PrismaClient,
  jupiterService: IJupiterService,
  walletService: WalletService,
  tokenBalanceService: TokenBalanceService,
) {
  const composer = new Composer<Context>()

  composer.command('portfolio', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /portfolio command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()

    try {
      // Get group
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (!group) {
        return ctx.reply(
          'This group has not been initialized yet. An admin needs to send /start first.',
        )
      }

      // Fetch SOL balance and all token balances in parallel (single RPC call for all tokens!)
      const [solBalance, allTokenBalances, solPriceUSD] = await Promise.all([
        walletService.getBalance(group.walletAddress),
        tokenBalanceService.getAllTokenBalances(group.walletAddress),
        jupiterService.getTokenPriceInUSD('So11111111111111111111111111111111111111112'),
      ])

      const solBalanceUSD = solPriceUSD ? (Number(solBalance) / LAMPORTS_PER_SOL) * solPriceUSD : null

      // Build portfolio message
      let message = `💼 <b>Group Portfolio</b>\n\n`
      message += `<b>SOL Balance:</b> ${formatSOL(solBalance)} SOL`
      if (solBalanceUSD) {
        message += ` (${formatUSD(solBalanceUSD)})`
      }
      message += '\n\n'

      // Get positions for cost basis info
      const positions = await prisma.position.findMany({
        where: { groupId: group.id },
      })
      const positionMap = new Map(positions.map(p => [p.tokenAddress, p]))

      if (allTokenBalances.length === 0) {
        message += `No token positions yet.\n\n`
        message += `Use /buy to start building your portfolio!`
      }
      else {
        message += `<b>Token Positions:</b>\n`

        // Fetch all token info and prices in parallel
        const tokenDataPromises = allTokenBalances.map(async (balance) => {
          const [tokenInfo, tokenPriceUSD] = await Promise.all([
            jupiterService.getTokenInfo(balance.mint),
            jupiterService.getTokenPriceInUSD(balance.mint, balance.decimals),
          ])
          return {
            balance,
            tokenInfo,
            tokenPriceUSD,
            position: positionMap.get(balance.mint),
          }
        })

        const tokenData = await Promise.all(tokenDataPromises)

        // Sort by value (highest first)
        tokenData.sort((a, b) => {
          const aValue = a.tokenPriceUSD ? (Number(a.balance.amount) / (10 ** a.balance.decimals)) * a.tokenPriceUSD : 0
          const bValue = b.tokenPriceUSD ? (Number(b.balance.amount) / (10 ** b.balance.decimals)) * b.tokenPriceUSD : 0
          return bValue - aValue
        })

        let totalPortfolioUSD = solBalanceUSD || 0

        for (let i = 0; i < tokenData.length; i++) {
          const { balance, tokenInfo, tokenPriceUSD, position } = tokenData[i]
          const tokenSymbol = tokenInfo?.symbol || 'Unknown'
          const decimals = balance.decimals

          // Format token amount
          const tokenAmount = formatTokenAmount(balance.amount, decimals)
          const costBasisSOL = position ? formatSOL(position.costBasis) : 'N/A'

          // Calculate USD value
          const tokenBalanceUSD = tokenPriceUSD ? (Number(balance.amount) / (10 ** decimals)) * tokenPriceUSD : null

          if (tokenBalanceUSD) {
            totalPortfolioUSD += tokenBalanceUSD
          }

          message += `• <b>${tokenSymbol}:</b> ${tokenAmount} tokens`
          if (tokenBalanceUSD) {
            message += ` (${formatUSD(tokenBalanceUSD)})`
          }
          message += `\n  Cost basis: ${costBasisSOL} SOL`
          const dexScreenerUrl = `https://dexscreener.com/solana/${encodeURIComponent(balance.mint)}`
          message += `\n  <a href="${dexScreenerUrl}">View on Dexscreener</a>`
          if (i < tokenData.length - 1) {
            message += '\n'
          }
        }

        // Add total portfolio value
        message += `\n\n<b>Total Portfolio Value:</b> ${formatUSD(totalPortfolioUSD)}`
      }

      // Try to reply to the original message, fall back to regular message if it's gone
      try {
        await ctx.reply(message, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        })
      }
      catch (replyError: any) {
        // If the original message is gone (deleted/timeout), send without reply
        if (replyError?.error_code === 400 && replyError?.description?.includes('message to be replied not found')) {
          await ctx.reply(message, { parse_mode: 'HTML' })
        }
        else {
          throw replyError
        }
      }
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to get portfolio')
      try {
        await ctx.reply('❌ Failed to get portfolio. Please try again.')
      }
      catch {
        // Ignore if we can't even send the error message
      }
    }
  })

  return composer
}
