import type { Context } from '#root/bot/context.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { Composer } from 'grammy'

const LAMPORTS_PER_SOL = 1_000_000_000

function formatSOL(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(4)
}

function _calculateOwnershipPercentage(userDeposits: bigint, totalDeposits: bigint): string {
  if (totalDeposits === 0n) {
    return '0.00'
  }
  const percentage = (Number(userDeposits) / Number(totalDeposits)) * 100
  return percentage.toFixed(2)
}

export function balanceFeature(prisma: PrismaClient, walletService: WalletService) {
  const composer = new Composer<Context>()

  composer.command('balance', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /balance command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()
    const userId = ctx.from?.id.toString()

    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

    const group = await prisma.group.findUnique({
      where: { telegramGroupId: chatId },
      include: {
        members: {
          where: {
            telegramUserId: userId,
          },
        },
      },
    })

    if (!group) {
      return ctx.reply(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    }

    const member = group.members[0]

    if (!member) {
      return ctx.reply('You haven\'t made any deposits yet. Use /deposit to get your deposit address.')
    }

    // Get the actual group wallet balance (the pooled funds)
    const groupWalletBalance = await walletService.getBalance(group.walletAddress)

    // Calculate user's ownership percentage and proportional share
    const ownershipPercentage = group.totalDeposits > 0n
      ? Number(member.deposits) / Number(group.totalDeposits)
      : 0
    const userProportionalShare = BigInt(Math.floor(Number(groupWalletBalance) * ownershipPercentage))

    // Calculate user's available balance (proportional share minus estimated fees)
    // Note: This is an estimate since we don't have access to connection here
    const estimatedFee = BigInt(5000) // ~0.000005 SOL for tx fee
    const estimatedRentExemption = BigInt(890880) // ~0.0009 SOL for rent exemption
    const totalEstimatedFees = estimatedFee + estimatedRentExemption
    const userFeeShare = BigInt(Math.floor(Number(totalEstimatedFees) * ownershipPercentage))
    const userAvailableBalance = userProportionalShare > userFeeShare
      ? userProportionalShare - userFeeShare
      : 0n

    const message = `💰 <b>Your Balance</b>

<b>Your Deposits:</b>
${formatSOL(member.deposits)} SOL

<b>Available Balance:</b>
${formatSOL(userAvailableBalance)} SOL

<b>Group Total Deposits:</b>
${formatSOL(group.totalDeposits)} SOL

<b>Group Wallet Balance:</b>
${formatSOL(groupWalletBalance)} SOL

<b>Your Ownership:</b>
${(ownershipPercentage * 100).toFixed(2)}%

<b>Your Deposit Address:</b>
<code>${member.depositAddress}</code>

Use /deposit to see deposit instructions.`

    await ctx.reply(message, {
      reply_parameters: { message_id: ctx.msg.message_id },
    })
  })

  return composer
}
