import type { Context } from '#root/bot/context.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

export function leaderboardFeature(prisma: PrismaClient) {
  const composer = new Composer<Context>()

  composer.command('leaderboard', async (ctx) => {
    // Prevent duplicate processing - use message ID as a simple guard
    const messageId = ctx.msg.message_id
    const processingKey = `leaderboard_${messageId}`

    // Check if we're already processing this message (simple in-memory guard)
    // In production, you might want to use Redis or similar
    if ((ctx.session as any)[processingKey]) {
      ctx.logger?.warn({ messageId }, 'Duplicate leaderboard command detected, ignoring')
      return
    }
    (ctx.session as any)[processingKey] = true

    try {
      // Fetch top public groups with cached PnL data
      // Only read from database - no RPC calls
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
        take: 20, // Get more groups for leaderboard
      })

      if (topGroups.length === 0) {
        return ctx.reply(
          '📊 <b>Global Leaderboard</b>\n\n'
          + 'No groups are currently on the leaderboard.\n\n'
          + 'Groups need to:\n'
          + '• Be initialized with /start\n'
          + '• Have public leaderboard enabled (default)\n'
          + '• Start trading to appear here\n\n'
          + '💡 PnL is recalculated hourly. If your group just started trading, it may take up to an hour to appear.',
          {
            parse_mode: 'HTML',
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

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

      // Check if we have any groups to display
      if (groupsWithPnL.length === 0) {
        return ctx.reply(
          '📊 <b>Global Leaderboard</b>\n\n'
          + 'No groups with cached PnL data are available at this time.\n\n'
          + 'PnL is recalculated hourly. Please try again later.',
          {
            parse_mode: 'HTML',
            reply_parameters: { message_id: ctx.msg.message_id },
          },
        )
      }

      // Sort by PnL percentage (descending)
      groupsWithPnL.sort((a, b) => b.pnlPercent - a.pnlPercent)

      // Build leaderboard message
      let leaderboardMessage = '🏆 <b>Global Trading Leaderboard</b>\n\n'
      leaderboardMessage += 'Top performing groups by PnL:\n\n'

      const displayCount = Math.min(10, groupsWithPnL.length)
      for (let i = 0; i < displayCount; i++) {
        const group = groupsWithPnL[i]
        const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
        const pnlSign = group.pnlPercent >= 0 ? '+' : ''
        const pnlColor = group.pnlPercent >= 0 ? '🟢' : '🔴'

        // Format values
        const pnlSol = (Number(group.pnlAmount) / 1_000_000_000).toFixed(2)
        const totalValueSol = (Number(group.totalValue) / 1_000_000_000).toFixed(2)

        // Format trading since date
        const tradingSinceDate = new Date(group.tradingSince)
        const tradingSinceFormatted = tradingSinceDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })

        leaderboardMessage += `${emoji} <b>Rank ${i + 1}</b>\n`
        leaderboardMessage += `   ${pnlColor} PnL: ${pnlSign}${group.pnlPercent.toFixed(2)}% (${pnlSign}${pnlSol} SOL)\n`
        leaderboardMessage += `   💰 Total Value: ${totalValueSol} SOL\n`
        leaderboardMessage += `   👥 Members: ${group.memberCount}\n`
        leaderboardMessage += `   📅 Trading Since: ${tradingSinceFormatted}\n\n`
      }

      // Add footer
      leaderboardMessage += '━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
      leaderboardMessage += '💡 <b>Want your group on the leaderboard?</b>\n'
      leaderboardMessage += 'Make sure your group is set to public with <code>/privacy public</code>\n\n'
      leaderboardMessage += '📊 PnL is recalculated hourly and includes all token positions.'

      await ctx.reply(leaderboardMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }
    catch (error) {
      ctx.logger?.error({ error }, 'Failed to fetch leaderboard')
      await ctx.reply(
        '❌ Failed to load leaderboard. Please try again later.',
        {
          reply_parameters: { message_id: ctx.msg.message_id },
        },
      )
    }
  })

  return composer
}
