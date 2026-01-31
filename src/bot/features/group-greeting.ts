import type { Context } from '#root/bot/context.js'
import { Composer } from 'grammy'

export function groupGreetingFeature() {
  const composer = new Composer<Context>()

  // Handle when bot is added to a group
  composer.on('message:new_chat_members', async (ctx) => {
    // Check if the bot itself was added
    const botId = ctx.me.id
    const newMembers = ctx.message.new_chat_members

    const isBotAdded = newMembers.some(member => member.id === botId)

    if (!isBotAdded) {
      return // Not our concern if other members are added
    }

    // Only send greeting in groups/supergroups
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const greetingMessage = `👋 <b>Hello everyone! I'm Pot Bot!</b>

I've been added to help your group trade together on Solana.

To get started, a group admin needs to initialize me by typing:
<code>/start</code>`

    await ctx.reply(greetingMessage, {
      parse_mode: 'HTML',
    })
  })

  return composer
}
