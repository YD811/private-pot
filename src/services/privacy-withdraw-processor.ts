import type { Bot } from '#root/bot/index.js'
import type { Logger } from '#root/logger.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import type { Keypair } from '@solana/web3.js'
import { config } from '#root/config.js'
import { PrivacyCashService } from '#root/services/privacy-cash.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'

export class PrivacyWithdrawProcessor {
  private isRunning = false
  private intervalId?: NodeJS.Timeout
  private readonly connection: Connection
  private bot?: Bot
  private walletService?: WalletService
  private readonly privacyCashService: PrivacyCashService

  constructor(
    private readonly prisma: PrismaClient,
    rpcUrl: string,
    private readonly logger: Logger,
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed')
    this.privacyCashService = new PrivacyCashService(logger)
  }

  setBot(bot: Bot) {
    this.bot = bot
  }

  setWalletService(walletService: WalletService) {
    this.walletService = walletService
  }

  async start(intervalMs: number = 30000) {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.logger.info('Privacy withdraw processor started')

    // Run immediately, then on interval
    try {
      await this.processReadyWithdrawals()
    }
    catch (error) {
      this.logger.error({ error }, 'Error during initial privacy withdrawal processing')
    }

    this.intervalId = setInterval(async () => {
      if (!this.isRunning) {
        if (this.intervalId) {
          clearInterval(this.intervalId)
          this.intervalId = undefined
        }
        return
      }

      try {
        await this.processReadyWithdrawals()
      }
      catch (error) {
        this.logger.error({ error }, 'Error processing privacy withdrawals')
      }
    }, intervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.logger.info('Privacy withdraw processor stopped')
  }

  /**
   * Process withdrawals that have been deposited to Privacy Cash and are ready for withdrawal
   */
  private async processReadyWithdrawals() {
    const now = new Date()

    // Find withdrawals that are ready to process (deposited and past scheduled time)
    const readyWithdrawals = await this.prisma.pendingPrivateWithdrawal.findMany({
      where: {
        status: 'deposited',
        scheduledWithdrawAt: {
          lte: now,
        },
      },
      take: 5, // Process up to 5 at a time
    })

    for (const withdrawal of readyWithdrawals) {
      if (!this.isRunning)
        break

      try {
        await this.processSingleWithdrawal(withdrawal)
      }
      catch (error: any) {
        this.logger.error(
          { error, withdrawalId: withdrawal.id },
          'Failed to process privacy withdrawal',
        )

        // Mark as failed
        await this.prisma.pendingPrivateWithdrawal.update({
          where: { id: withdrawal.id },
          data: {
            status: 'failed',
            errorMessage: error.message || 'Unknown error',
          },
        })

        // Notify user of failure
        await this.notifyFailure(withdrawal, error.message)
      }
    }
  }

  /**
   * Process a single pending withdrawal - perform Privacy Cash withdrawals and transfers
   */
  private async processSingleWithdrawal(withdrawal: {
    id: string
    groupId: string
    memberId: string
    recipientAddress: string
    amount: bigint
    tempWallet1Address: string | null
    tempWallet2Address: string | null
    tempWallet1Key: string | null
    tempWallet2Key: string | null
    withdraw1Amount: bigint | null
    withdraw2Amount: bigint | null
  }) {
    if (!this.walletService) {
      throw new Error('Wallet service not set')
    }

    this.logger.info(
      { withdrawalId: withdrawal.id, amount: withdrawal.amount.toString() },
      'Processing privacy withdrawal',
    )

    // Get group info (we need the group wallet for Privacy Cash operations)
    const group = await this.prisma.group.findUnique({
      where: { id: withdrawal.groupId },
    })
    const member = await this.prisma.member.findUnique({
      where: { id: withdrawal.memberId },
    })

    if (!group || !member) {
      throw new Error('Group or member not found')
    }

    // Restore the group wallet to use for Privacy Cash operations
    const groupWallet = this.walletService.restoreWallet(
      group.encryptedPrivateKey,
      group.encryptionIv,
    )
    const groupPrivateKeyBase58 = bs58.encode(groupWallet.secretKey)

    // Generate temp wallets if not already set
    if (!withdrawal.tempWallet1Key || !withdrawal.tempWallet2Key) {
      throw new Error('Temp wallet keys not set')
    }

    const tempWallet1 = this.privacyCashService.decodeKeypair(withdrawal.tempWallet1Key)
    const tempWallet2 = this.privacyCashService.decodeKeypair(withdrawal.tempWallet2Key)

    // Calculate split amounts
    const { amount1, amount2 } = this.privacyCashService.calculateSplitAmounts(withdrawal.amount)

    // Update withdrawal with status
    await this.prisma.pendingPrivateWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'withdrawing',
        withdraw1Amount: amount1,
        withdraw2Amount: amount2,
      },
    })

    const privacyCashConfig = {
      rpcUrl: config.solanaRpcUrl,
      ownerPrivateKey: groupPrivateKeyBase58,
    }

    // Perform first withdrawal to temp wallet
    this.logger.info(
      { withdrawalId: withdrawal.id, amount: amount1.toString(), recipient: tempWallet1.publicKey.toBase58() },
      'Performing first Privacy Cash withdrawal',
    )

    const withdraw1Result = await this.privacyCashService.withdraw(
      privacyCashConfig,
      amount1,
      tempWallet1.publicKey.toBase58(),
    )

    await this.prisma.pendingPrivateWithdrawal.update({
      where: { id: withdrawal.id },
      data: { withdraw1TxSignature: withdraw1Result.signature },
    })

    // Small delay between withdrawals
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Perform second withdrawal to temp wallet
    this.logger.info(
      { withdrawalId: withdrawal.id, amount: amount2.toString(), recipient: tempWallet2.publicKey.toBase58() },
      'Performing second Privacy Cash withdrawal',
    )

    const withdraw2Result = await this.privacyCashService.withdraw(
      privacyCashConfig,
      amount2,
      tempWallet2.publicKey.toBase58(),
    )

    await this.prisma.pendingPrivateWithdrawal.update({
      where: { id: withdrawal.id },
      data: { withdraw2TxSignature: withdraw2Result.signature },
    })

    // Wait for withdrawals to confirm
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Transfer from both temp wallets to user's destination
    const destinationAddress = withdrawal.recipientAddress

    this.logger.info(
      { withdrawalId: withdrawal.id, destination: destinationAddress },
      'Transferring from temp wallets to user destination',
    )

    // Transfer from temp wallet 1
    const transfer1Sig = await this.transferFromTempWallet(tempWallet1, destinationAddress)

    // Transfer from temp wallet 2
    const transfer2Sig = await this.transferFromTempWallet(tempWallet2, destinationAddress)

    // Create official withdrawal record
    const officialWithdrawal = await this.prisma.withdrawal.create({
      data: {
        groupId: withdrawal.groupId,
        memberId: withdrawal.memberId,
        amount: withdrawal.amount,
        recipientAddress: destinationAddress,
        transactionSignature: transfer1Sig || transfer2Sig || `private_${withdrawal.id}`,
        executedAt: new Date(),
      },
    })

    // Mark as completed
    await this.prisma.pendingPrivateWithdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'completed',
        withdrawalId: officialWithdrawal.id,
      },
    })

    this.logger.info(
      { withdrawalId: withdrawal.id },
      'Privacy withdrawal completed successfully',
    )

    // Notify user of success
    await this.notifySuccess(group, member, withdrawal.amount, destinationAddress)
  }

  private async transferFromTempWallet(tempWallet: Keypair, destinationAddress: string): Promise<string | null> {
    const destinationPubkey = new PublicKey(destinationAddress)

    // Get balance
    const balance = await this.connection.getBalance(tempWallet.publicKey)
    const rentExemption = 890880
    const txFee = 5000
    const transferAmount = BigInt(balance) - BigInt(rentExemption) - BigInt(txFee)

    if (transferAmount <= 0n) {
      this.logger.warn(
        { wallet: tempWallet.publicKey.toBase58(), balance },
        'Insufficient balance in temp wallet, skipping transfer',
      )
      return null
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tempWallet.publicKey,
        toPubkey: destinationPubkey,
        lamports: transferAmount,
      }),
    )

    const { blockhash } = await this.connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = tempWallet.publicKey

    transaction.sign(tempWallet)
    const signature = await this.connection.sendRawTransaction(transaction.serialize())
    await this.connection.confirmTransaction(signature, 'confirmed')

    this.logger.info(
      {
        from: tempWallet.publicKey.toBase58(),
        to: destinationAddress,
        amount: transferAmount.toString(),
        signature,
      },
      'Transferred from temp wallet to user destination',
    )

    return signature
  }

  private async notifySuccess(
    group: { telegramGroupId: string },
    member: { telegramUserId: string, telegramUsername: string | null },
    amount: bigint,
    destinationAddress: string,
  ) {
    if (!this.bot) {
      return
    }

    const solAmount = (Number(amount) / LAMPORTS_PER_SOL).toFixed(4)
    const username = member.telegramUsername ? `@${member.telegramUsername}` : 'A member'

    // Notify group
    const groupMessage = `🔒 <b>Private Withdrawal Complete!</b>

${username} withdrew <b>${solAmount} SOL</b> privately.

<i>Funds routed through Privacy Cash with split withdrawals for enhanced privacy.</i>`

    try {
      await this.bot.api.sendMessage(group.telegramGroupId, groupMessage, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      this.logger.error({ error }, 'Failed to notify group about private withdrawal')
    }

    // DM the user
    const dmMessage = `✅ <b>Private Withdrawal Complete!</b>

<b>${solAmount} SOL</b> has been privately sent to:
<code>${destinationAddress}</code>

<i>Your withdrawal was routed through Privacy Cash for enhanced privacy.</i>`

    try {
      await this.bot.api.sendMessage(member.telegramUserId, dmMessage, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      this.logger.debug({ error }, 'Failed to DM user about withdrawal (user may not have started bot)')
    }
  }

  private async notifyFailure(
    withdrawal: { groupId: string, memberId: string, amount: bigint, recipientAddress: string },
    errorMessage: string,
  ) {
    if (!this.bot) {
      return
    }

    const member = await this.prisma.member.findUnique({
      where: { id: withdrawal.memberId },
    })

    if (!member) {
      return
    }

    const solAmount = (Number(withdrawal.amount) / LAMPORTS_PER_SOL).toFixed(4)

    const dmMessage = `⚠️ <b>Private Withdrawal Failed</b>

Your withdrawal of <b>${solAmount} SOL</b> encountered an error:
<code>${errorMessage}</code>

Please try again or contact support.`

    try {
      await this.bot.api.sendMessage(member.telegramUserId, dmMessage, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      this.logger.debug({ error }, 'Failed to DM user about withdrawal failure')
    }
  }
}
