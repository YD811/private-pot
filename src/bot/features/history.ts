import type { Context } from '#root/bot/context.js'
import type { IJupiterService } from '#root/services/jupiter-interface.js'
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

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
}

function getExplorerUrl(txId: string, rpcUrl: string): string {
  const isDevnet = rpcUrl.includes('devnet')
  const cluster = isDevnet ? '?cluster=devnet' : ''
  return `https://explorer.solana.com/tx/${txId}${cluster}`
}

export function historyFeature(
  prisma: PrismaClient,
  jupiterService: IJupiterService,
  solanaRpcUrl: string,
) {
  const composer = new Composer<Context>()

  composer.command('history', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /history command is only available in group chats.')
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

      // Get last 10 trades ordered by execution time (descending)
      const trades = await prisma.trade.findMany({
        where: { groupId: group.id },
        include: {
          trader: true,
        },
        orderBy: { executedAt: 'desc' },
        take: 10,
      })

      if (trades.length === 0) {
        const message = `📈 <b>Trade History</b>

No trades have been executed yet.

Use /buy or /sell to start trading!`

        return ctx.reply(message, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        })
      }

      // Build history message
      let message = `📈 <b>Trade History</b>\n\n`

      for (let i = 0; i < trades.length; i++) {
        const trade = trades[i]

        // Get token info
        const tokenInfo = await jupiterService.getTokenInfo(trade.tokenAddress)
        const tokenSymbol = tokenInfo?.symbol || 'Unknown'

        // Format amounts
        const amountInSOL = formatSOL(trade.amountIn)
        const amountOutFormatted = formatTokenAmount(trade.amountOut, tokenInfo?.decimals || 9)

        // Format trader name
        const traderName = trade.trader.telegramUsername
          ? `@${trade.trader.telegramUsername}`
          : 'User'

        // Format date
        const formattedDate = formatDate(trade.executedAt)

        // Get explorer URL
        const explorerUrl = getExplorerUrl(trade.transactionSignature, solanaRpcUrl)

        // Build trade line
        message += `<b>${i + 1}.</b> ${trade.tradeType.toUpperCase()} ${tokenSymbol}\n`

        if (trade.tradeType === 'buy') {
          message += `   💰 ${amountInSOL} SOL → ${amountOutFormatted} ${tokenSymbol}\n`
        }
        else {
          message += `   💰 ${amountOutFormatted} ${tokenSymbol} → ${amountInSOL} SOL\n`
        }

        message += `   👤 ${traderName}\n`
        message += `   🕐 ${formattedDate}\n`
        message += `   🔗 <a href="${explorerUrl}">View Transaction</a>`
        if (i < trades.length - 1) {
          message += '\n\n'
        }
      }

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
        link_preview_options: { is_disabled: true },
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to get trade history')
      await ctx.reply('❌ Failed to get trade history. Please try again.')
    }
  })

  return composer
}
