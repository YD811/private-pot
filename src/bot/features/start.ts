import type { Context } from '#root/bot/context.js'
import type { GroupService } from '#root/services/group.js'
import type { PrismaClient } from '@prisma/client'
import { generateSolanaPayQR } from '#root/services/qr-code.js'
import { Composer, InputFile } from 'grammy'

export function startFeature(prisma: PrismaClient, groupService: GroupService) {
  const composer = new Composer<Context>()

  composer.command('start', async (ctx) => {
    try {
      if (ctx.chat?.type === 'private') {
        // Check for deposit deep link: /start deposit_<telegramGroupId>
        const match = ctx.match
        // Handle both string match and RegExp match result
        const matchString = typeof match === 'string' && match ? match : undefined
        if (matchString && matchString.startsWith('deposit_')) {
          const telegramGroupId = matchString.replace('deposit_', '')
          const userId = ctx.from?.id.toString()

          if (!userId) {
            return ctx.reply('Unable to identify user.')
          }

          // Find the group
          const group = await prisma.group.findUnique({
            where: { telegramGroupId },
          })

          if (!group) {
            return ctx.reply(
              '❌ Group not found. The group may not have been initialized yet.',
            )
          }

          try {
            // Get or create member for this group
            const username = ctx.from?.username
            const member = await groupService.getOrCreateMember(
              group.id,
              userId,
              username,
            )

            // Get all groups where user has deposits
            const allMemberships = await groupService.getMembershipsWithDeposits(userId)

            // Get group name for the requested group
            let requestedGroupName = 'Unknown Group'
            try {
              const chatInfo = await ctx.api.getChat(Number(telegramGroupId))
              requestedGroupName = 'title' in chatInfo && chatInfo.title ? chatInfo.title : 'Unknown Group'
            }
            catch {
              // Fallback to group ID if we can't get the name
            }

            // Build caption for QR code message (keep under 1024 chars)
            let caption = `💰 <b>Deposit to ${requestedGroupName}</b>\n\n`
            caption += `<code>${member.depositAddress}</code>\n\n`
            caption += `📱 Scan QR with Phantom, Solflare, etc.\n`
            caption += `✅ Only send SOL (no tokens)\n`
            caption += `✅ Funds auto-sweep to group pot`

            // Generate and send QR code with caption
            try {
              const qrBuffer = await generateSolanaPayQR(member.depositAddress, requestedGroupName)
              await ctx.replyWithPhoto(new InputFile(qrBuffer, 'deposit-qr.png'), {
                caption,
                parse_mode: 'HTML',
              })
            }
            catch (qrError) {
              ctx.logger?.warn({ error: qrError }, 'Failed to generate QR code')
              // Fallback to text-only if QR fails
              await ctx.reply(caption, { parse_mode: 'HTML' })
            }

            // Send groups list as separate message if user has deposits
            if (allMemberships.length > 0) {
              let groupsMessage = `<b>📊 Your Groups with Deposits:</b>\n\n`

              for (const membership of allMemberships) {
                try {
                  const chatInfo = await ctx.api.getChat(Number(membership.group.telegramGroupId))
                  const groupName = 'title' in chatInfo && chatInfo.title ? chatInfo.title : 'Unknown Group'
                  const ownershipPercent = membership.group.totalDeposits > 0n
                    ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * 100
                    : 0
                  const depositAmount = (Number(membership.deposits) / 1_000_000_000).toFixed(4)
                  const pnlPercent = membership.group.cachedPnLPercent ?? 0
                  const pnlSign = pnlPercent >= 0 ? '+' : ''
                  const pnlColor = pnlPercent >= 0 ? '🟢' : '🔴'

                  groupsMessage += `<b>${groupName}</b>\n`
                  groupsMessage += `💰 ${depositAmount} SOL · ${ownershipPercent.toFixed(1)}% · ${pnlColor} ${pnlSign}${pnlPercent.toFixed(1)}%\n\n`
                }
                catch {
                  const depositAmount = (Number(membership.deposits) / 1_000_000_000).toFixed(4)
                  groupsMessage += `<b>Unknown Group</b>\n`
                  groupsMessage += `💰 ${depositAmount} SOL\n\n`
                }
              }

              await ctx.reply(groupsMessage, { parse_mode: 'HTML' })
            }

            return
          }
          catch (error) {
            ctx.logger?.error({ error, match: matchString }, 'Error handling deposit deep link')
            return ctx.reply(
              '❌ An error occurred while processing your deposit request. Please try again later.',
            )
          }
        }

        // Fetch top public groups with cached PnL data only
        // No RPC calls - only read from database
        const topGroups = await prisma.group.findMany({
          where: {
            isPublicLeaderboard: true,
            // Only include groups with cached PnL data
            cachedPnLAmount: { not: null },
            cachedPnLPercent: { not: null },
            cachedCurrentValue: { not: null },
          },
          include: {
            trades: {
              orderBy: {
                executedAt: 'asc',
              },
              take: 1,
            },
            members: true,
          },
          take: 10,
        })

        // Extract groups with cached PnL data
        // No RPC calls - all data comes from database
        const groupsWithPnL = topGroups
          .filter((group) => {
            // Double-check that cached values exist (TypeScript guard)
            return group.cachedPnLAmount !== null
              && group.cachedPnLPercent !== null
              && group.cachedCurrentValue !== null
          })
          .map((group) => {
            // Get member count
            const memberCount = group.members.length

            // Get trading since date (first trade or creation date)
            const tradingSince = group.trades.length > 0
              ? group.trades[0].executedAt
              : group.createdAt

            return {
              id: group.id,
              telegramGroupId: group.telegramGroupId,
              pnlAmount: group.cachedPnLAmount!,
              pnlPercent: group.cachedPnLPercent!,
              totalValue: group.cachedCurrentValue!,
              memberCount,
              tradingSince,
            }
          })

        // Sort by PnL percentage (descending)
        groupsWithPnL.sort((a, b) => b.pnlPercent - a.pnlPercent)

        // Build top groups message
        let topGroupsMessage = ''
        if (groupsWithPnL.length > 0) {
          topGroupsMessage = '\n\n<b>🏆 Top Trading Groups by Performance:</b>\n\n'

          for (let i = 0; i < Math.min(5, groupsWithPnL.length); i++) {
            const group = groupsWithPnL[i]
            const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📊'
            const pnlSign = group.pnlPercent >= 0 ? '+' : ''
            const pnlColor = group.pnlPercent >= 0 ? '🟢' : '🔴'

            // Format values
            const pnlUsd = (Number(group.pnlAmount) / 1_000_000_000).toFixed(2)
            const totalValueUsd = (Number(group.totalValue) / 1_000_000_000).toFixed(2)

            // Format trading since date
            const tradingSinceDate = new Date(group.tradingSince)
            const tradingSinceFormatted = tradingSinceDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })

            topGroupsMessage += `${emoji} Group ${i + 1}\n`
            topGroupsMessage += `   ${pnlColor} PnL: ${pnlSign}${group.pnlPercent.toFixed(2)}% (${pnlSign}${pnlUsd} SOL)\n`
            topGroupsMessage += `   💰 Total Value: ${totalValueUsd} SOL\n`
            topGroupsMessage += `   👥 Members: ${group.memberCount}\n`
            topGroupsMessage += `   📅 Trading Since: ${tradingSinceFormatted}\n\n`
          }
        }

        const welcomeMessage = `👋 <b>Welcome to Pot Bot!</b>

<b>🤖 What is Pot Bot?</b>
A Telegram bot that helps groups pool funds and trade together on Solana. Perfect for trading communities, DAOs, and investment clubs.

<b>📋 Available Commands:</b>

<b>💰 For Members:</b>
/deposit - Get your deposit address
/balance - Check your balance
/withdraw - Withdraw your funds
/portfolio - View group holdings
/history - See trade history

<b>📈 For Traders:</b>
/buy - Buy tokens with group funds
/sell - Sell tokens for SOL

<b>👥 For Admins:</b>
/add_trader - Grant trading permission
/remove_trader - Revoke trading permission
/set_limit - Set trade limits
/pause / /unpause - Control trading

<b>ℹ️ Other:</b>
/help - Get detailed help
/members - View group members
/limits - View trading limits${topGroupsMessage}
<b>🚀 Want to create your own trading group?</b>
Add @${ctx.me.username} to your group and use /start to initialize!

Questions? Type /help for more information.`

        return ctx.reply(welcomeMessage, { parse_mode: 'HTML' })
      }

      const chatId = ctx.chat.id.toString()

      const existingGroup = await prisma.group.findUnique({
        where: { telegramGroupId: chatId },
      })

      if (existingGroup) {
        return ctx.reply(
          `✅ This group is already initialized!\n\n`
          + `<b>Wallet Address:</b>\n<code>${existingGroup.walletAddress}</code>\n\n`
          + `Use /deposit to get your deposit code.`,
        )
      }

      const chatAdmins = await ctx.getChatAdministrators()
      const isAdmin = chatAdmins.some(admin => admin.user.id === ctx.from?.id)

      if (!isAdmin) {
        return ctx.reply('⛔️ Only group administrators can initialize the bot.')
      }

      await groupService.getOrCreateGroup(chatId)
      const groupName = ctx.chat?.title || 'your group'

      const onboardingMessage = `✅ <b>Group Initialized Successfully!</b>
🎉 <b>Welcome to Pot Bot, ${groupName}!</b>

Your group trading pot has been created. Here's how to get started:
━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 <b>STEP 1: DEPOSIT FUNDS</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
Each member should type <code>/deposit</code> to get their unique Solana deposit address.

When you send SOL to your address:
✓ Funds automatically sweep to the group pot
✓ Your ownership % is calculated instantly
✓ You can track your balance anytime with <code>/balance</code>
━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 <b>STEP 2: DESIGNATE TRADERS</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
Group admins can grant trading permissions:
<code>/add_trader @username</code> - Give someone permission to trade
<code>/remove_trader @username</code> - Revoke trading permission

Traders can execute <code>/buy</code> and <code>/sell</code> commands using the group's pooled funds.
━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 <b>STEP 3: START TRADING!</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━
Once funds are deposited and traders are designated, you're ready to trade together!

Useful commands:
• <code>/portfolio</code> - View current holdings
• <code>/history</code> - See all trades
• <code>/members</code> - List all members and roles
• <code>/set_limit</code> - Set max trade size
• <code>/help</code> - Full command list
━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 <b>Your group's performance will appear on the global leaderboard once you start trading!</b>

Let's make some gains together! 🚀`

      await ctx.reply(onboardingMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    catch (error) {
      ctx.logger?.error({ error }, 'Error in /start command')
      await ctx.reply(
        '❌ An error occurred while processing your request. Please try again later.',
        {
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      )
    }
  })

  return composer
}
