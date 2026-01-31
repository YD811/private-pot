import type { Context } from '#root/bot/context.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

const LAMPORTS_PER_SOL = 1_000_000_000

function formatSOL(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(4)
}

export function limitsFeature(prisma: PrismaClient) {
  const composer = new Composer<Context>()

  composer.command('limits', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /limits command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()
    const userId = ctx.from?.id.toString()

    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

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

      // Get member
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
          'This group has not been initialized yet. An admin needs to send /start first.',
        )
      }

      // Build limits message
      let message = `📊 <b>Your Trade Limits</b>\n\n`

      // Per-trade limit
      if (member.tradeLimit) {
        message += `<b>Per-trade limit:</b> ${formatSOL(member.tradeLimit)} SOL\n`
      }
      else {
        message += `<b>Per-trade limit:</b> None\n`
      }

      // Daily limit
      if (member.dailyLimit) {
        message += `<b>Daily limit:</b> ${formatSOL(member.dailyLimit)} SOL\n\n`

        // Calculate today's usage
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const dailyTrades = await prisma.trade.aggregate({
          where: {
            groupId: group.id,
            traderId: member.id,
            executedAt: {
              gte: today,
            },
          },
          _sum: {
            amountIn: true,
          },
        })

        const dailyUsed = BigInt(dailyTrades._sum.amountIn || 0)
        const remaining = member.dailyLimit - dailyUsed

        message += `<b>Today's usage:</b> ${formatSOL(dailyUsed)} SOL\n`
        message += `<b>Remaining today:</b> ${formatSOL(remaining)} SOL\n\n`

        if (remaining === 0n) {
          message += `You can trade up to ${formatSOL(member.tradeLimit || BigInt(0))} SOL per trade, but you've reached your daily limit.`
        }
        else {
          const perTradeLimit = member.tradeLimit ? formatSOL(member.tradeLimit) : 'any amount'
          message += `You can trade up to ${perTradeLimit} SOL per trade and ${formatSOL(remaining)} SOL more today.`
        }
      }
      else {
        message += `<b>Daily limit:</b> None\n\n`
        const perTradeLimit = member.tradeLimit ? formatSOL(member.tradeLimit) : 'any amount'
        message += `You can trade up to ${perTradeLimit} SOL per trade.`
      }

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to get trade limits')
      await ctx.reply('❌ Failed to get trade limits. Please try again.')
    }
  })

  return composer
}
