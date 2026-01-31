import type { Context } from '#root/bot/context.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

export function privacyFeature(prisma: PrismaClient) {
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

      return admins.some(admin => admin.user.id === userId)
    }
    catch (error) {
      ctx.logger?.error({ error }, 'Failed to check admin status')
      return false
    }
  }

  composer.command('privacy', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /privacy command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()

    const isUserAdmin = await isAdmin(ctx)
    if (!isUserAdmin) {
      return ctx.reply('❌ Only group administrators can change privacy settings.')
    }

    const group = await prisma.group.findUnique({
      where: { telegramGroupId: chatId },
    })

    if (!group) {
      return ctx.reply(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    }

    // Get the privacy setting from command arguments
    const args = ctx.message?.text?.split(' ').slice(1) || []
    const setting = args[0]?.toLowerCase()

    if (!setting || (setting !== 'public' && setting !== 'private')) {
      const currentStatus = group.isPublicLeaderboard ? 'public' : 'private'
      const statusEmoji = group.isPublicLeaderboard ? '🌐' : '🔒'

      return ctx.reply(
        `🔒 <b>Privacy Settings</b>

Current status: ${statusEmoji} <b>${currentStatus}</b>

<b>Usage:</b>
<code>/privacy public</code> - Appear on leaderboard (default)
<code>/privacy private</code> - Hide from leaderboard

${group.isPublicLeaderboard
  ? 'Your group is currently visible on the public leaderboard.'
  : 'Your group is currently hidden from the public leaderboard.'}`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      )
    }

    // Update privacy setting
    const isPublic = setting === 'public'

    await prisma.group.update({
      where: { id: group.id },
      data: { isPublicLeaderboard: isPublic },
    })

    const statusEmoji = isPublic ? '🌐' : '🔒'
    const statusText = isPublic ? 'public' : 'private'

    await ctx.reply(
      `✅ <b>Privacy Setting Updated</b>

${statusEmoji} Your group is now <b>${statusText}</b>

${isPublic
  ? 'Your group will appear on the public leaderboard.'
  : 'Your group is now hidden from the public leaderboard.'}`,
      {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      },
    )
  })

  return composer
}
