import type { Context } from '#root/bot/context.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

const LAMPORTS_PER_SOL = 1_000_000_000

function formatSOL(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(4)
}

function calculateOwnershipPercentage(userDeposits: bigint, totalDeposits: bigint): string {
  if (totalDeposits === 0n) {
    return '0.00'
  }
  const percentage = (Number(userDeposits) / Number(totalDeposits)) * 100
  return percentage.toFixed(2)
}

export function membersFeature(prisma: PrismaClient) {
  const composer = new Composer<Context>()

  composer.command('members', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /members command is only available in group chats.')
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

      // Get all members ordered by deposits (descending)
      const members = await prisma.member.findMany({
        where: { groupId: group.id },
        orderBy: { deposits: 'desc' },
      })

      if (members.length === 0) {
        const message = `👥 <b>Group Members</b>

No members have made deposits yet.

Use /deposit to join the group!`

        return ctx.reply(message, {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        })
      }

      // Build members list
      let message = `👥 <b>Group Members</b>\n\n`

      members.forEach((member, index) => {
        const username = member.telegramUsername ? `@${member.telegramUsername}` : 'User'
        const deposits = formatSOL(member.deposits)
        const ownership = calculateOwnershipPercentage(member.deposits, group.totalDeposits)

        message += `<b>${index + 1}.</b> ${username}\n`
        message += `   💰 ${deposits} SOL (${ownership}%)\n\n`
      })

      message += `<b>Total:</b> ${formatSOL(group.totalDeposits)} SOL`

      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to get members list')
      await ctx.reply('❌ Failed to get members list. Please try again.')
    }
  })

  return composer
}
