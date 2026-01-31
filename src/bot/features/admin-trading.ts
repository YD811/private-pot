import type { Context } from '#root/bot/context.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

export function adminTradingFeature(prisma: PrismaClient, walletService: WalletService) {
  const composer = new Composer<Context>()

  // Helper to check if user is admin
  async function isAdmin(ctx: Context): Promise<boolean> {
    if (ctx.chat?.type === 'private') {
      return false
    }

    try {
      const admins = await ctx.getChatAdministrators()
      const userId = ctx.from?.id

      if (!userId) {
        ctx.logger?.warn('No user ID found in context')
        return false
      }

      const isUserAdmin = admins.some(admin => admin.user.id === userId)
      ctx.logger?.debug({ userId, isUserAdmin, adminCount: admins.length }, 'Admin check result')
      return isUserAdmin
    }
    catch (error) {
      ctx.logger?.error({ error }, 'Failed to check admin status')
      return false
    }
  }

  // /add_trader command
  composer.command('add_trader', async (ctx) => {
    ctx.logger?.info({ userId: ctx.from?.id, chatId: ctx.chat?.id }, 'add_trader command received')

    if (ctx.chat?.type === 'private') {
      return ctx.reply('This command is only available in group chats.')
    }

    const isUserAdmin = await isAdmin(ctx)
    if (!isUserAdmin) {
      ctx.logger?.warn({ userId: ctx.from?.id }, 'Non-admin user attempted to add trader')
      return ctx.reply('❌ Only group administrators can add traders.')
    }

    const chatId = ctx.chat.id.toString()

    // Get user from reply
    const replyUser = ctx.msg?.reply_to_message?.from || ctx.message?.reply_to_message?.from

    if (!replyUser) {
      ctx.logger?.debug('No reply-to-message found, showing help')
      return ctx.reply(`💡 <b>Add Trader</b>

<b>Usage:</b>
Reply to a user's message with <code>/add_trader</code>

This grants the user permission to execute trades.`, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }

    const targetUserId = replyUser.id

    if (!targetUserId) {
      ctx.logger?.warn({ replyUser }, 'Unable to get target user ID')
      return ctx.reply('❌ Unable to identify the user.')
    }

    ctx.logger?.info({ targetUserId, targetUsername: replyUser.username }, 'Processing add_trader request')

    try {
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (!group) {
        ctx.logger?.warn({ chatId }, 'Group not found')
        return ctx.reply('This group has not been initialized yet.')
      }

      ctx.logger?.debug({ groupId: group.id }, 'Group found, processing member')

      // Use transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Find or create the member
        let member = await tx.member.findUnique({
          where: {
            groupId_telegramUserId: {
              groupId: group.id,
              telegramUserId: targetUserId.toString(),
            },
          },
        })

        // Create member if they don't exist
        if (!member) {
          ctx.logger?.info({ targetUserId, groupId: group.id }, 'Creating new member')
          // Generate proper wallet credentials using WalletService
          const depositWallet = walletService.createUserDepositWallet(group.id, targetUserId.toString())

          member = await tx.member.create({
            data: {
              groupId: group.id,
              telegramUserId: targetUserId.toString(),
              telegramUsername: replyUser.username || null,
              depositAddress: depositWallet.publicKey,
              encryptedPrivateKey: depositWallet.encryptedPrivateKey,
              encryptionIv: depositWallet.iv,
              deposits: BigInt(0),
              isTrader: false,
            },
          })
        }
        else {
          ctx.logger?.info({ memberId: member.id, isTrader: member.isTrader }, 'Member found')
        }

        // Update trader status
        const updatedMember = await tx.member.update({
          where: { id: member.id },
          data: { isTrader: true },
        })

        return { member: updatedMember }
      })

      const username = replyUser.username || replyUser.first_name || 'User'
      ctx.logger?.info({ targetUserId, username, memberId: result.member.id }, 'Successfully added trader')

      // Get all traders in the group
      const allTraders = await prisma.member.findMany({
        where: {
          groupId: group.id,
          isTrader: true,
        },
        select: {
          telegramUsername: true,
        },
      })

      // Build trader list
      let traderList = ''
      for (const trader of allTraders) {
        const traderName = trader.telegramUsername ? `@${trader.telegramUsername}` : 'User'
        const isAdmin = trader.telegramUsername === replyUser.username
        traderList += `• ${traderName}${isAdmin ? ' (Admin)' : ' (Trader)'}\n`
      }

      await ctx.reply(
        `✅ <b>Trader Added!</b>

${username} now has trading permissions.

They can now use:
• <code>/buy &lt;token_address&gt; &lt;amount_in_sol&gt;</code>
• <code>/sell &lt;token_address&gt; &lt;amount_of_tokens&gt;</code>

<b>Current traders in this group:</b>
${traderList}

Use <code>/remove_trader @username</code> to revoke permissions.`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      )
    }
    catch (error) {
      ctx.logger?.error({ error, targetUserId, chatId }, 'Failed to add trader')
      await ctx.reply('❌ Failed to add trader. Please try again.')
    }
  })

  // /remove_trader command
  composer.command('remove_trader', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('This command is only available in group chats.')
    }

    if (!await isAdmin(ctx)) {
      return ctx.reply('❌ Only group administrators can remove traders.')
    }

    const chatId = ctx.chat.id.toString()

    // Get user from reply
    const replyUser = ctx.msg?.reply_to_message?.from || ctx.message?.reply_to_message?.from

    if (!replyUser) {
      return ctx.reply(`💡 <b>Remove Trader</b>

<b>Usage:</b>
Reply to a user's message with <code>/remove_trader</code>

This revokes the user's trading permission.`, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }

    const targetUserId = replyUser.id

    if (!targetUserId) {
      return ctx.reply('❌ Unable to identify the user.')
    }

    try {
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (!group) {
        return ctx.reply('This group has not been initialized yet.')
      }

      // Find the member
      const member = await prisma.member.findUnique({
        where: {
          groupId_telegramUserId: {
            groupId: group.id,
            telegramUserId: targetUserId.toString(),
          },
        },
      })

      if (!member) {
        return ctx.reply('❌ This user is not a member yet.')
      }

      // Update trader status
      await prisma.member.update({
        where: { id: member.id },
        data: { isTrader: false },
      })

      const username = replyUser.username || replyUser.first_name || 'User'
      await ctx.reply(`✅ <b>Trader Removed</b>\n\n${username} can no longer execute trades.`, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to remove trader')
      await ctx.reply('❌ Failed to remove trader. Please try again.')
    }
  })

  // /pause command
  composer.command('pause', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('This command is only available in group chats.')
    }

    if (!await isAdmin(ctx)) {
      return ctx.reply('❌ Only group administrators can pause trading.')
    }

    const chatId = ctx.chat.id.toString()

    try {
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (!group) {
        return ctx.reply('This group has not been initialized yet.')
      }

      await prisma.group.update({
        where: { id: group.id },
        data: { isPaused: true },
      })

      await ctx.reply('⏸️ <b>Trading Paused</b>\n\nAll trading activities have been paused. Use /unpause to resume.', {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to pause trading')
      await ctx.reply('❌ Failed to pause trading. Please try again.')
    }
  })

  // /unpause command
  composer.command('unpause', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('This command is only available in group chats.')
    }

    if (!await isAdmin(ctx)) {
      return ctx.reply('❌ Only group administrators can resume trading.')
    }

    const chatId = ctx.chat.id.toString()

    try {
      const group = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (!group) {
        return ctx.reply('This group has not been initialized yet.')
      }

      await prisma.group.update({
        where: { id: group.id },
        data: { isPaused: false },
      })

      await ctx.reply('▶️ <b>Trading Resumed</b>\n\nAll trading activities have been resumed.', {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      ctx.logger.error({ error }, 'Failed to resume trading')
      await ctx.reply('❌ Failed to resume trading. Please try again.')
    }
  })

  return composer
}
