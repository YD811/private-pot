import type { Context } from '#root/bot/context.js'
import type { GroupService } from '#root/services/group.js'
import type { PrismaClient } from '@prisma/client'
import { config } from '#root/config.js'
import { Composer, InlineKeyboard } from 'grammy'

export function depositFeature(
  prisma: PrismaClient,
  _groupService: GroupService,
) {
  const composer = new Composer<Context>()

  composer.command('deposit', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /deposit command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()

    if (!ctx.from?.id) {
      return ctx.reply('Unable to identify user.')
    }

    const group = await prisma.group.findUnique({
      where: { telegramGroupId: chatId },
    })

    if (!group) {
      return ctx.reply(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    }

    const botUsername = ctx.me.username
    if (!botUsername) {
      return ctx.reply('Bot username not available. Please try again later.')
    }

    const deepLink = `https://t.me/${botUsername}?start=deposit_${chatId}`

    const privacyNote = config.privacyCashEnabled
      ? `\n\n🔒 <b>Privacy Enabled:</b> Your deposits will be routed through Privacy Cash for enhanced privacy with split withdrawals.`
      : ''

    const message = `💰 <b>Get Your Personal Deposit Address</b>

Click the button below to get your personal deposit address in a private message.

You'll also see a list of all groups where you have deposits!${privacyNote}`

    const keyboard = new InlineKeyboard().url(
      'Click here to get personal deposit address',
      deepLink,
    )

    await ctx.reply(message, {
      reply_markup: keyboard,
      reply_parameters: { message_id: ctx.msg.message_id },
    })
  })

  return composer
}
