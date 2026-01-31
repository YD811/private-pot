import type { Bot } from '#root/bot/index.js'
import type { Logger } from '#root/logger.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import type { Keypair } from '@solana/web3.js'
import { config } from '#root/config.js'
import { PrivacyCashService } from '#root/services/privacy-cash.js'
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'

export class PrivacySweepProcessor {
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
    this.logger.info('Privacy sweep processor started')

    // Run immediately, then on interval
    try {
      await this.processReadySweeps()
    }
    catch (error) {
      this.logger.error({ error }, 'Error during initial privacy sweep processing')
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
        await this.processReadySweeps()
      }
      catch (error) {
        this.logger.error({ error }, 'Error processing privacy sweeps')
      }
    }, intervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.logger.info('Privacy sweep processor stopped')
  }

  /**
   * Process sweeps that have been deposited and are ready for withdrawal
   */
  private async processReadySweeps() {
    const now = new Date()

    // Find sweeps that are ready to process (deposited and past scheduled time)
    const readySweeps = await this.prisma.pendingPrivateSweep.findMany({
      where: {
        status: 'deposited',
        scheduledWithdrawAt: {
          lte: now,
        },
      },
      take: 5, // Process up to 5 at a time
    })

    for (const sweep of readySweeps) {
      if (!this.isRunning)
        break

      try {
        await this.processSingleSweep(sweep)
      }
      catch (error: any) {
        this.logger.error(
          { error, sweepId: sweep.id },
          'Failed to process privacy sweep',
        )

        // Mark as failed
        await this.prisma.pendingPrivateSweep.update({
          where: { id: sweep.id },
          data: {
            status: 'failed',
            errorMessage: error.message || 'Unknown error',
          },
        })
      }
    }
  }

  /**
   * Process a single pending sweep - perform withdrawals and transfers
   */
  private async processSingleSweep(sweep: {
    id: string
    groupId: string
    memberId: string
    amount: bigint
    depositSignature: string
    tempWallet1Address: string | null
    tempWallet2Address: string | null
    withdraw1Amount: bigint | null
    withdraw2Amount: bigint | null
  }) {
    if (!this.walletService) {
      throw new Error('Wallet service not set')
    }

    this.logger.info(
      { sweepId: sweep.id, amount: sweep.amount.toString() },
      'Processing privacy sweep withdrawals',
    )

    // Get group and member info
    const group = await this.prisma.group.findUnique({
      where: { id: sweep.groupId },
    })
    const member = await this.prisma.member.findUnique({
      where: { id: sweep.memberId },
    })

    if (!group || !member) {
      throw new Error('Group or member not found')
    }

    // Restore the member's wallet to use for Privacy Cash operations
    const memberWallet = this.walletService.restoreWallet(
      member.encryptedPrivateKey,
      member.encryptionIv,
    )
    const memberPrivateKeyBase58 = bs58.encode(memberWallet.secretKey)

    // Generate temp wallets if not already set
    if (sweep.tempWallet1Address && sweep.tempWallet2Address) {
      // This shouldn't happen in normal flow, but handle it
      throw new Error('Temp wallets already set but sweep still pending')
    }

    const { wallet1: tempWallet1, wallet2: tempWallet2 } = this.privacyCashService.generateTempWallets()

    // Calculate split amounts
    const { amount1, amount2 } = this.privacyCashService.calculateSplitAmounts(sweep.amount)

    // Update sweep with temp wallet info
    await this.prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: {
        status: 'withdrawing',
        tempWallet1Address: tempWallet1.publicKey.toBase58(),
        tempWallet2Address: tempWallet2.publicKey.toBase58(),
        withdraw1Amount: amount1,
        withdraw2Amount: amount2,
      },
    })

    const privacyCashConfig = {
      rpcUrl: config.solanaRpcUrl,
      ownerPrivateKey: memberPrivateKeyBase58,
    }

    // Perform first withdrawal
    this.logger.info(
      { sweepId: sweep.id, amount: amount1.toString(), recipient: tempWallet1.publicKey.toBase58() },
      'Performing first withdrawal',
    )

    const withdraw1Result = await this.privacyCashService.withdraw(
      privacyCashConfig,
      amount1,
      tempWallet1.publicKey.toBase58(),
    )

    await this.prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { withdraw1TxSignature: withdraw1Result.signature },
    })

    // Small delay between withdrawals
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Perform second withdrawal
    this.logger.info(
      { sweepId: sweep.id, amount: amount2.toString(), recipient: tempWallet2.publicKey.toBase58() },
      'Performing second withdrawal',
    )

    const withdraw2Result = await this.privacyCashService.withdraw(
      privacyCashConfig,
      amount2,
      tempWallet2.publicKey.toBase58(),
    )

    await this.prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { withdraw2TxSignature: withdraw2Result.signature },
    })

    // Wait for withdrawals to confirm
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Transfer from both temp wallets to group pot
    const groupPotAddress = group.walletAddress

    this.logger.info(
      { sweepId: sweep.id, destination: groupPotAddress },
      'Transferring from temp wallets to group pot',
    )

    // Transfer from temp wallet 1
    await this.transferFromTempWallet(tempWallet1, groupPotAddress)

    // Transfer from temp wallet 2
    await this.transferFromTempWallet(tempWallet2, groupPotAddress)

    // Mark as completed
    await this.prisma.pendingPrivateSweep.update({
      where: { id: sweep.id },
      data: { status: 'completed' },
    })

    // Update deposit record
    await this.prisma.deposit.update({
      where: { transactionSignature: sweep.depositSignature },
      data: { sweptAt: new Date() },
    })

    this.logger.info(
      { sweepId: sweep.id },
      'Privacy sweep completed successfully',
    )

    // Notify group
    await this.notifyGroup(group, member, sweep.amount)
  }

  private async transferFromTempWallet(tempWallet: Keypair, destinationAddress: string) {
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
      return
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
      'Transferred from temp wallet to group pot',
    )
  }

  private async notifyGroup(
    group: { telegramGroupId: string },
    member: { telegramUsername: string | null },
    amount: bigint,
  ) {
    if (!this.bot) {
      return
    }

    const solAmount = (Number(amount) / LAMPORTS_PER_SOL).toFixed(4)
    const username = member.telegramUsername ? `@${member.telegramUsername}` : 'A member'

    const message = `🔒 <b>Private Sweep Complete!</b>

${username}'s deposit of <b>${solAmount} SOL</b> has been privately transferred to the group pot.

<i>Funds routed through Privacy Cash with split withdrawals for enhanced privacy.</i>`

    try {
      await this.bot.api.sendMessage(group.telegramGroupId, message, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      this.logger.error({ error }, 'Failed to notify group about private sweep')
    }
  }
}
