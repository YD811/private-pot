import type { Context } from '#root/bot/context.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { config } from '#root/config.js'
import { PrivacyCashService } from '#root/services/privacy-cash.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { Composer } from 'grammy'

function formatSOL(lamports: bigint): string {
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  return sol.toFixed(4)
}

function parseSOLAmount(input: string): bigint | null {
  const amount = Number.parseFloat(input)
  if (Number.isNaN(amount) || amount <= 0) {
    return null
  }
  return BigInt(Math.floor(amount * LAMPORTS_PER_SOL))
}

function isValidSolanaAddress(address: string): boolean {
  try {
    const pubkey = new PublicKey(address)
    return PublicKey.isOnCurve(pubkey.toBytes())
  }
  catch {
    return false
  }
}

export function withdrawFeature(
  prisma: PrismaClient,
  walletService: WalletService,
  solanaRpcUrl: string,
) {
  const composer = new Composer<Context>()
  const privacyCashService = new PrivacyCashService(console as any)
  const isDevnet = solanaRpcUrl.includes('devnet')

  composer.command('withdraw', async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('The /withdraw command is only available in group chats.')
    }

    const chatId = ctx.chat.id.toString()
    const userId = ctx.from?.id.toString()

    if (!userId) {
      return ctx.reply('Unable to identify user.')
    }

    // Parse command arguments
    const args = ctx.match?.toString().trim().split(/\s+/) || []
    if (args.length < 2) {
      const privacyNote = config.privacyCashEnabled && !isDevnet
        ? `\n\n🔒 <b>Privacy Enabled:</b> Withdrawals are routed through Privacy Cash for enhanced privacy.`
        : ''

      const helpMessage = `💸 <b>Withdraw Funds</b>

<b>Usage:</b>
<code>/withdraw &lt;amount&gt; &lt;address&gt;</code>

<b>Examples:</b>
• <code>/withdraw 0.5 YourSolanaAddressHere</code>
• <code>/withdraw all YourSolanaAddressHere</code>

<b>Parameters:</b>
• <b>amount</b>: Amount in SOL to withdraw, or "all" for your available balance
• <b>address</b>: Your Solana wallet address to receive funds

<b>Notes:</b>
• You can withdraw your proportional share of the group's current wallet balance
• Transaction fees will be deducted from the withdrawal amount
• Minimum withdrawal: 0.01 SOL${privacyNote}`

      return ctx.reply(helpMessage, {
        reply_parameters: { message_id: ctx.msg.message_id },
      })
    }

    const [amountArg, withdrawalAddress] = args

    // Validate withdrawal address
    if (!isValidSolanaAddress(withdrawalAddress)) {
      return ctx.reply('❌ Invalid Solana address. Please provide a valid Solana wallet address.')
    }

    // Get group and member info
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
      return ctx.reply('You haven\'t made any deposits yet. There\'s nothing to withdraw.')
    }

    if (member.deposits === 0n) {
      return ctx.reply('Your balance is zero. There\'s nothing to withdraw.')
    }

    // Get current group wallet balance
    const groupWalletBalance = await walletService.getBalance(group.walletAddress)

    // Calculate user's ownership percentage
    const ownershipPercentage = group.totalDeposits > 0n
      ? Number(member.deposits) / Number(group.totalDeposits)
      : 0

    // Calculate user's proportional share of current group wallet balance
    const userProportionalShare = BigInt(Math.floor(Number(groupWalletBalance) * ownershipPercentage))

    // Get estimated fees and rent exemption
    const connection = new Connection(solanaRpcUrl, 'confirmed')
    const rentExemption = await connection.getMinimumBalanceForRentExemption(0)
    const estimatedFee = BigInt(5000) // ~0.000005 SOL for tx fee
    const totalFees = BigInt(rentExemption) + estimatedFee

    // Calculate user's available balance (proportional share minus their portion of fees)
    const userFeeShare = BigInt(Math.floor(Number(totalFees) * ownershipPercentage))
    const userAvailableBalance = userProportionalShare > userFeeShare
      ? userProportionalShare - userFeeShare
      : 0n

    // Parse amount
    let withdrawalAmount: bigint
    if (amountArg.toLowerCase() === 'all') {
      withdrawalAmount = userAvailableBalance
    }
    else {
      const parsedAmount = parseSOLAmount(amountArg)
      if (!parsedAmount) {
        return ctx.reply('❌ Invalid amount. Please provide a valid number (e.g., 0.5) or "all".')
      }
      withdrawalAmount = parsedAmount
    }

    // Validate withdrawal amount - minimum 0.01 SOL for Privacy Cash
    const minWithdrawal = BigInt(Math.floor(0.01 * LAMPORTS_PER_SOL)) // 0.01 SOL minimum
    if (withdrawalAmount < minWithdrawal) {
      return ctx.reply(`❌ Minimum withdrawal is 0.01 SOL. You tried to withdraw ${formatSOL(withdrawalAmount)} SOL.`)
    }

    if (withdrawalAmount > userAvailableBalance) {
      return ctx.reply(
        `❌ Insufficient balance. You have ${formatSOL(userAvailableBalance)} SOL available but tried to withdraw ${formatSOL(withdrawalAmount)} SOL.`,
      )
    }

    // Check if Privacy Cash is enabled
    const usePrivacy = config.privacyCashEnabled && !isDevnet

    // Send processing message
    const privacyInfo = usePrivacy
      ? '\n\n🔒 <i>Using Privacy Cash for enhanced privacy. This may take 3-5 minutes.</i>'
      : ''
    const processingMsg = await ctx.reply(
      `⏳ Processing withdrawal of ${formatSOL(withdrawalAmount)} SOL to <code>${withdrawalAddress}</code>...${privacyInfo}`,
    )

    try {
      // Restore group wallet
      const groupWallet = walletService.restoreWallet(
        group.encryptedPrivateKey,
        group.encryptionIv,
      )

      // Check group wallet balance
      const requiredBalance = withdrawalAmount + totalFees
      if (groupWalletBalance < requiredBalance) {
        await ctx.api.editMessageText(
          chatId,
          processingMsg.message_id,
          `❌ <b>Withdrawal Failed</b>

Group wallet has insufficient balance to process this withdrawal.

<b>Group Balance:</b> ${formatSOL(groupWalletBalance)} SOL
<b>Required:</b> ${formatSOL(requiredBalance)} SOL (including fees and rent)

Please contact an admin to check the group wallet.`,
          { parse_mode: 'HTML' },
        )
        return
      }

      if (usePrivacy) {
        // Queue private withdrawal via Privacy Cash
        await queuePrivateWithdrawal(
          prisma,
          privacyCashService,
          walletService,
          connection,
          ctx,
          processingMsg.message_id,
          group,
          member,
          withdrawalAmount,
          withdrawalAddress,
        )
      }
      else {
        // Regular direct withdrawal
        await executeDirectWithdrawal(
          prisma,
          connection,
          ctx,
          processingMsg.message_id,
          group,
          member,
          groupWallet,
          withdrawalAmount,
          withdrawalAddress,
          userAvailableBalance,
          solanaRpcUrl,
        )
      }
    }
    catch (error) {
      ctx.logger.error({ error, userId, groupId: group.id }, 'Withdrawal failed')

      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await ctx.api.editMessageText(
        chatId,
        processingMsg.message_id,
        `❌ <b>Withdrawal Failed</b>

An error occurred while processing your withdrawal:
<code>${errorMessage}</code>

Please try again or contact an admin if the problem persists.`,
        { parse_mode: 'HTML' },
      )
    }
  })

  return composer
}

/**
 * Queue a private withdrawal through Privacy Cash
 */
async function queuePrivateWithdrawal(
  prisma: PrismaClient,
  privacyCashService: PrivacyCashService,
  walletService: WalletService,
  connection: Connection,
  ctx: Context,
  messageId: number,
  group: { id: string, telegramGroupId: string, walletAddress: string, encryptedPrivateKey: string, encryptionIv: string, totalDeposits: bigint },
  member: { id: string, deposits: bigint },
  withdrawalAmount: bigint,
  withdrawalAddress: string,
) {
  const chatId = ctx.chat!.id.toString()

  // Restore group wallet
  const groupWallet = walletService.restoreWallet(
    group.encryptedPrivateKey,
    group.encryptionIv,
  )
  const groupPrivateKeyBase58 = bs58.encode(groupWallet.secretKey)

  // Check group wallet balance and calculate available for Privacy Cash
  const groupBalance = await connection.getBalance(groupWallet.publicKey)
  const rentExemption = 890880n // ~0.00089 SOL
  const txFee = 5000n // Transaction fee
  const privacyCashBuffer = 3000000n // 0.003 SOL buffer for Privacy Cash internal costs (nullifier PDAs, compute budget)
  const minPrivacyAmount = 10000000n // 0.01 SOL minimum for Privacy Cash

  const availableForPrivacy = BigInt(groupBalance) - rentExemption - txFee - privacyCashBuffer

  // If not enough for Privacy Cash minimum or withdrawal amount, fallback to direct
  if (availableForPrivacy < minPrivacyAmount || availableForPrivacy < withdrawalAmount) {
    ctx.logger.info(
      { groupBalance, availableForPrivacy: availableForPrivacy.toString(), withdrawalAmount: withdrawalAmount.toString() },
      'Insufficient balance for Privacy Cash, using direct withdrawal',
    )

    await ctx.api.editMessageText(
      chatId,
      messageId,
      `⏳ Processing withdrawal of ${formatSOL(withdrawalAmount)} SOL...

<i>Using direct transfer (amount too small for Privacy Cash).</i>`,
      { parse_mode: 'HTML' },
    )

    await executeDirectWithdrawal(
      prisma,
      connection,
      ctx,
      messageId,
      group,
      member,
      groupWallet,
      withdrawalAmount,
      withdrawalAddress,
      withdrawalAmount,
      config.solanaRpcUrl,
    )
    return
  }

  // Generate temp wallets for split withdrawals
  const { wallet1: tempWallet1, wallet2: tempWallet2 } = privacyCashService.generateTempWallets()

  // Deposit to Privacy Cash (use withdrawal amount, not the full available)
  const privacyCashConfig = {
    rpcUrl: config.solanaRpcUrl,
    ownerPrivateKey: groupPrivateKeyBase58,
  }

  let depositResult
  try {
    // Add timeout to prevent hanging
    const depositPromise = privacyCashService.deposit(privacyCashConfig, withdrawalAmount)
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Privacy Cash deposit timed out after 60 seconds')), 60000),
    )
    depositResult = await Promise.race([depositPromise, timeoutPromise])
  }
  catch (error: any) {
    // Fallback to regular withdrawal
    const errorMessage = error?.message || error?.toString() || 'Unknown error'
    ctx.logger.warn({ error: errorMessage }, 'Privacy Cash deposit failed, falling back to regular withdrawal')

    await ctx.api.editMessageText(
      chatId,
      messageId,
      `⚠️ <b>Privacy Transfer Failed</b>

Privacy Cash encountered an error. Processing via regular transfer instead...`,
      { parse_mode: 'HTML' },
    )

    // Execute regular withdrawal
    await executeDirectWithdrawal(
      prisma,
      connection,
      ctx,
      messageId,
      group,
      member,
      groupWallet,
      withdrawalAmount,
      withdrawalAddress,
      withdrawalAmount, // userAvailableBalance approximation
      config.solanaRpcUrl,
    )
    return
  }

  // Calculate scheduled withdrawal time (2-5 minutes delay)
  const scheduledWithdrawAt = privacyCashService.getScheduledWithdrawTime()
  const delayMinutes = Math.ceil((scheduledWithdrawAt.getTime() - Date.now()) / 60000)

  // Create pending withdrawal record
  await prisma.pendingPrivateWithdrawal.create({
    data: {
      groupId: group.id,
      memberId: member.id,
      recipientAddress: withdrawalAddress,
      amount: withdrawalAmount,
      status: 'deposited',
      depositTxSignature: depositResult.signature,
      tempWallet1Address: tempWallet1.publicKey.toBase58(),
      tempWallet2Address: tempWallet2.publicKey.toBase58(),
      tempWallet1Key: privacyCashService.encodeKeypair(tempWallet1),
      tempWallet2Key: privacyCashService.encodeKeypair(tempWallet2),
      scheduledWithdrawAt,
    },
  })

  // Calculate proportional reduction in deposits
  const depositReduction = withdrawalAmount

  // Update member balance and group total in database
  await prisma.$transaction([
    prisma.member.update({
      where: { id: member.id },
      data: { deposits: member.deposits - depositReduction },
    }),
    prisma.group.update({
      where: { id: group.id },
      data: { totalDeposits: group.totalDeposits - depositReduction },
    }),
  ])

  // Update message to show pending status
  const solAmount = formatSOL(withdrawalAmount)
  await ctx.api.editMessageText(
    chatId,
    messageId,
    `🔒 <b>Private Withdrawal Initiated</b>

<b>${solAmount} SOL</b> deposited to Privacy Cash pool.

Split withdrawals will complete in ~${delayMinutes} minutes.

<i>Your funds are being privately routed to your wallet.</i>

Destination: <code>${withdrawalAddress}</code>`,
    { parse_mode: 'HTML' },
  )
}

/**
 * Execute a regular direct withdrawal (non-private)
 */
async function executeDirectWithdrawal(
  prisma: PrismaClient,
  connection: Connection,
  ctx: Context,
  messageId: number,
  group: { id: string, telegramGroupId: string, walletAddress: string, totalDeposits: bigint },
  member: { id: string, deposits: bigint },
  groupWallet: any,
  withdrawalAmount: bigint,
  withdrawalAddress: string,
  userAvailableBalance: bigint,
  solanaRpcUrl: string,
) {
  const chatId = ctx.chat!.id.toString()
  const recipientPubkey = new PublicKey(withdrawalAddress)

  // Create withdrawal transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: groupWallet.publicKey,
      toPubkey: recipientPubkey,
      lamports: withdrawalAmount,
    }),
  )

  // Get recent blockhash and set fee payer
  const { blockhash } = await connection.getLatestBlockhash()
  transaction.recentBlockhash = blockhash
  transaction.feePayer = groupWallet.publicKey

  // Sign and send transaction
  transaction.sign(groupWallet)
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false, preflightCommitment: 'confirmed' },
  )

  // Wait for confirmation
  await connection.confirmTransaction(signature, 'confirmed')

  // Calculate proportional reduction in deposits
  const depositReduction = BigInt(Math.floor(Number(member.deposits) * (Number(withdrawalAmount) / Number(userAvailableBalance))))

  // Update member balance and group total in database
  await prisma.$transaction([
    prisma.member.update({
      where: { id: member.id },
      data: { deposits: member.deposits - depositReduction },
    }),
    prisma.group.update({
      where: { id: group.id },
      data: { totalDeposits: group.totalDeposits - depositReduction },
    }),
    prisma.withdrawal.create({
      data: {
        groupId: group.id,
        memberId: member.id,
        amount: withdrawalAmount,
        recipientAddress: withdrawalAddress,
        transactionSignature: signature,
        executedAt: new Date(),
      },
    }),
  ])

  // Send success message
  const newBalance = member.deposits - depositReduction
  const explorerUrl = solanaRpcUrl.includes('devnet')
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : `https://explorer.solana.com/tx/${signature}`

  const successMessage = `✅ <b>Withdrawal Successful!</b>

<b>Amount:</b> ${formatSOL(withdrawalAmount)} SOL
<b>Recipient:</b> <code>${withdrawalAddress}</code>
<b>New Balance:</b> ${formatSOL(newBalance)} SOL

<b>Transaction:</b>
<a href="${explorerUrl}">${signature.slice(0, 8)}...${signature.slice(-8)}</a>

Your funds have been sent to your wallet!`

  await ctx.api.editMessageText(
    chatId,
    messageId,
    successMessage,
    { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  )
}
