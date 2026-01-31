import type { Context } from '#root/bot/context.js'
import type { GroupService } from '#root/services/group.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

export function groupsFeature(prisma: PrismaClient, groupService: GroupService, walletService: WalletService) {
  const composer = new Composer<Context>()

  composer.command('groups', async (ctx) => {
    // Only works in DM
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('Use this command in a private chat with the bot.')
    }

    const userId = ctx.from?.id.toString()
    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

    // Get all memberships with deposits
    const memberships = await groupService.getMembershipsWithDeposits(userId)

    if (memberships.length === 0) {
      return ctx.reply(
        `📊 <b>Your Groups</b>\n\nYou haven't deposited to any groups yet.\n\nUse /deposit in a group to get started!`,
        { parse_mode: 'HTML' },
      )
    }

    let message = `📊 <b>Your Groups (${memberships.length})</b>\n\n`

    for (const membership of memberships) {
      try {
        const chatInfo = await ctx.api.getChat(Number(membership.group.telegramGroupId))
        const groupName = 'title' in chatInfo && chatInfo.title ? chatInfo.title : 'Unknown Group'

        const ownershipPercent = membership.group.totalDeposits > 0n
          ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * 100
          : 0

        // Original deposit amount
        const depositAmount = (Number(membership.deposits) / 1_000_000_000).toFixed(4)

        // Get current wallet balance
        const currentBalance = await walletService.getBalance(membership.group.walletAddress)
        // Calculate user's share of current balance based on ownership
        const userShare = membership.group.totalDeposits > 0n
          ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * Number(currentBalance)
          : 0
        const currentAmount = (userShare / 1_000_000_000).toFixed(4)

        const pnlPercent = membership.group.cachedPnLPercent ?? 0
        const pnlSign = pnlPercent >= 0 ? '+' : ''
        const pnlColor = pnlPercent >= 0 ? '🟢' : '🔴'

        message += `<b>${groupName}</b>\n`
        message += `💰 Deposited: ${depositAmount} SOL → Current: ${currentAmount} SOL\n`
        message += `📊 ${ownershipPercent.toFixed(1)}% ownership · ${pnlColor} PnL: ${pnlSign}${pnlPercent.toFixed(2)}%\n`
        message += `📍 <code>${membership.depositAddress}</code>\n\n`
      }
      catch {
        // Fallback: try to get current balance even if chat info fails
        try {
          const ownershipPercent = membership.group.totalDeposits > 0n
            ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * 100
            : 0
          const depositAmount = (Number(membership.deposits) / 1_000_000_000).toFixed(4)
          const currentBalance = await walletService.getBalance(membership.group.walletAddress)
          const userShare = membership.group.totalDeposits > 0n
            ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * Number(currentBalance)
            : 0
          const currentAmount = (userShare / 1_000_000_000).toFixed(4)
          const pnlPercent = membership.group.cachedPnLPercent ?? 0
          const pnlSign = pnlPercent >= 0 ? '+' : ''
          const pnlColor = pnlPercent >= 0 ? '🟢' : '🔴'

          message += `<b>Unknown Group</b>\n`
          message += `💰 Deposited: ${depositAmount} SOL → Current: ${currentAmount} SOL\n`
          message += `📊 ${ownershipPercent.toFixed(1)}% ownership · ${pnlColor} PnL: ${pnlSign}${pnlPercent.toFixed(2)}%\n`
          message += `📍 <code>${membership.depositAddress}</code>\n\n`
        }
        catch {
          // Final fallback: show deposit amount if balance fetch fails
          const depositAmount = (Number(membership.deposits) / 1_000_000_000).toFixed(4)
          const ownershipPercent = membership.group.totalDeposits > 0n
            ? (Number(membership.deposits) / Number(membership.group.totalDeposits)) * 100
            : 0
          message += `<b>Unknown Group</b>\n`
          message += `💰 Deposited: ${depositAmount} SOL\n`
          message += `📊 ${ownershipPercent.toFixed(1)}% ownership\n`
          message += `📍 <code>${membership.depositAddress}</code>\n\n`
        }
      }
    }

    message += `💡 Tap an address to copy, then deposit more SOL!`

    await ctx.reply(message, { parse_mode: 'HTML' })
  })

  return composer
}
