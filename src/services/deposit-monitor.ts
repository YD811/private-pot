import type { Bot } from '#root/bot/index.js'
import type { Logger } from '#root/logger.js'
import type { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { config } from '#root/config.js'
import { PrivacyCashService } from '#root/services/privacy-cash.js'
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { RPCRotator } from './rpc-rotator.js'

const COMMISSION_RATE_BPS = 15 // 0.15% in basis points

export class DepositMonitorService {
  private isRunning = false
  private processedSignatures = new Set<string>()
  private readonly connection: ReturnType<RPCRotator['createConnection']>
  private bot?: Bot
  private walletService?: WalletService
  private intervalId?: NodeJS.Timeout
  private readonly memberDelay = 5000 // 5 seconds between processing members
  private readonly isDevnet: boolean
  private readonly privacyCashService: PrivacyCashService

  constructor(
    private readonly prisma: PrismaClient,
    rpcUrls: string | string[],
    private readonly logger: Logger,
    private readonly rateLimiter: RPCRateLimiter,
  ) {
    // Create RPC rotator for read-only operations
    const rpcRotator = new RPCRotator(rpcUrls, rateLimiter, logger)
    this.connection = rpcRotator.createConnection('confirmed')

    // Detect if we're on devnet
    const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls]
    this.isDevnet = urls.some(url => url.includes('devnet'))

    // Initialize Privacy Cash service
    this.privacyCashService = new PrivacyCashService(logger)
  }

  private getExplorerUrl(signature: string): string {
    const baseUrl = `https://solscan.io/tx/${signature}`
    return this.isDevnet ? `${baseUrl}?cluster=devnet` : baseUrl
  }

  setBot(bot: Bot) {
    this.bot = bot
  }

  setWalletService(walletService: WalletService) {
    this.walletService = walletService
  }

  async start(intervalMs: number = 60000) {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.logger.info('Deposit monitor started')

    try {
      // Run immediately, then on interval
      await this.checkForDeposits()
    }
    catch (error) {
      this.logger.error({ error }, 'Error during initial deposit check')
      // Don't stop the monitor if initial check fails
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
        await this.checkForDeposits()
      }
      catch (error) {
        this.logger.error({ error }, 'Error checking for deposits')
      }
    }, intervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.logger.info('Deposit monitor stopped')
  }

  private async checkForDeposits() {
    // Don't start new checks if we're shutting down
    if (!this.isRunning) {
      return
    }

    // Skip check if circuit breaker is open
    if (this.rateLimiter.isCircuitBreakerOpen()) {
      this.logger.warn(
        { consecutiveErrors: this.rateLimiter.getConsecutiveErrors() },
        'Skipping deposit check - circuit breaker is open',
      )
      return
    }

    // Skip check if we've hit too many consecutive rate limits (legacy check)
    if (this.rateLimiter.shouldSkip()) {
      this.logger.warn(
        { consecutiveErrors: this.rateLimiter.getConsecutiveErrors() },
        'Skipping deposit check due to consecutive rate limit errors',
      )
      return
    }

    this.logger.debug('Starting deposit check')

    // Get all members with deposit addresses
    const members = await this.prisma.member.findMany({
      select: {
        id: true,
        groupId: true,
        depositAddress: true,
        telegramUserId: true,
      },
    })

    this.logger.debug({ memberCount: members.length }, 'Checking deposit addresses')

    // Process members with rate limiting - one at a time with delays
    for (let i = 0; i < members.length; i++) {
      // Check if we should stop during processing
      if (!this.isRunning) {
        this.logger.debug('Stopping deposit check due to shutdown')
        break
      }

      // Skip if we've hit too many rate limits
      if (this.rateLimiter.shouldSkip()) {
        this.logger.warn('Stopping member processing due to rate limits')
        break
      }

      const member = members[i]
      try {
        await this.checkMemberDeposits(member)
        // Reset counter on successful check
        this.rateLimiter.resetErrors()
      }
      catch (error: any) {
        this.logger.error(
          { error, memberId: member.id, depositAddress: member.depositAddress },
          'Error checking member deposits',
        )
      }

      // Add delay between members (except for the last one or if shutting down)
      if (i < members.length - 1 && this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.memberDelay))
      }
    }
  }

  private async checkMemberDeposits(member: {
    id: string
    groupId: string
    depositAddress: string
    telegramUserId: string
  }) {
    const publicKey = new PublicKey(member.depositAddress)

    // Get recent signatures with retry logic
    const signatures = await this.rateLimiter.executeWithRetry(
      () => this.connection.getSignaturesForAddress(
        publicKey,
        { limit: 5 },
        'confirmed',
      ),
      'getSignaturesForAddress',
    )

    for (const sigInfo of signatures) {
      // Skip if already processed
      if (this.processedSignatures.has(sigInfo.signature)) {
        continue
      }

      // Get transaction details with retry logic
      const tx = await this.rateLimiter.executeWithRetry(
        () => this.connection.getParsedTransaction(
          sigInfo.signature,
          {
            maxSupportedTransactionVersion: 0,
          },
        ),
        'getParsedTransaction',
      )

      // Rate limiting is handled by the singleton rate limiter

      if (!tx || !tx.meta) {
        this.processedSignatures.add(sigInfo.signature)
        continue
      }

      // Check if already recorded
      const existingDeposit = await this.prisma.deposit.findUnique({
        where: { transactionSignature: sigInfo.signature },
      })

      if (existingDeposit) {
        this.processedSignatures.add(sigInfo.signature)
        continue
      }

      // Calculate deposit amount
      const accountKeys = tx.transaction.message.accountKeys
      const recipientIndex = accountKeys.findIndex(
        (key: any) => key.pubkey.toBase58() === member.depositAddress,
      )

      if (recipientIndex === -1) {
        this.processedSignatures.add(sigInfo.signature)
        continue
      }

      const preBalance = tx.meta.preBalances[recipientIndex] ?? 0
      const postBalance = tx.meta.postBalances[recipientIndex] ?? 0
      const amount = BigInt(postBalance - preBalance)

      if (amount <= 0n) {
        this.processedSignatures.add(sigInfo.signature)
        continue
      }

      // Record the deposit
      await this.recordDeposit(
        member.groupId,
        member.id,
        sigInfo.signature,
        amount,
        new Date(sigInfo.blockTime! * 1000),
      )

      this.logger.info(
        {
          memberId: member.id,
          telegramUserId: member.telegramUserId,
          amount: amount.toString(),
          signature: sigInfo.signature,
        },
        'Deposit detected',
      )

      this.processedSignatures.add(sigInfo.signature)
    }
  }

  private async recordDeposit(
    groupId: string,
    memberId: string,
    signature: string,
    amount: bigint,
    detectedAt: Date,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Create deposit record
      const deposit = await tx.deposit.create({
        data: {
          groupId,
          memberId,
          transactionSignature: signature,
          amount,
          detectedAt,
        },
      })

      // Update member's total deposits
      const member = await tx.member.update({
        where: { id: memberId },
        data: {
          deposits: {
            increment: amount,
          },
        },
      })

      // Update group's total deposits
      const group = await tx.group.update({
        where: { id: groupId },
        data: {
          totalDeposits: {
            increment: amount,
          },
        },
      })

      return { deposit, member, group }
    })

    // Notify the group
    await this.notifyGroup(
      {
        id: result.group.id,
        telegramGroupId: result.group.telegramGroupId,
        walletAddress: result.group.walletAddress,
        totalDeposits: result.group.totalDeposits,
      },
      {
        id: result.member.id,
        telegramUserId: result.member.telegramUserId,
        telegramUsername: result.member.telegramUsername,
        deposits: result.member.deposits,
      },
      amount,
      signature,
    )

    // Sweep funds - use Privacy Cash on mainnet if enabled, otherwise regular sweep
    if (config.privacyCashEnabled && !this.isDevnet) {
      await this.queuePrivateSweep(result.group, result.member, amount, signature)
    }
    else {
      await this.sweepToMainPot(result.group, result.member, amount, signature)
    }
  }

  private async notifyGroup(
    group: { id: string, telegramGroupId: string, walletAddress: string, totalDeposits: bigint },
    member: { id: string, telegramUserId: string, telegramUsername: string | null, deposits: bigint },
    amount: bigint,
    _signature: string,
  ) {
    if (!this.bot) {
      this.logger.warn('Bot not set, cannot notify group')
      return
    }

    const solAmount = (Number(amount) / LAMPORTS_PER_SOL).toFixed(4)
    const username = member.telegramUsername ? `@${member.telegramUsername}` : 'User'

    // Calculate ownership percentage
    const ownershipPercent = member.deposits > 0n && group.totalDeposits > 0n
      ? ((Number(member.deposits) / Number(group.totalDeposits)) * 100).toFixed(2)
      : '0.00'

    // Get member count
    const memberCount = await this.prisma.member.count({
      where: { groupId: group.id },
    })

    // Format total pot value
    const totalPotSol = (Number(group.totalDeposits) / LAMPORTS_PER_SOL).toFixed(2)

    const message = `✅ <b>Deposit Confirmed!</b>

${username} deposited <b>${solAmount} SOL</b>

<b>📊 Group Stats Updated:</b>

• Total Pot Value: <b>${totalPotSol} SOL</b>
• ${username} ownership: <b>${ownershipPercent}%</b>
• Total Members: <b>${memberCount}</b>

Use <code>/portfolio</code> to view the group's holdings!`

    try {
      await this.bot.api.sendMessage(group.telegramGroupId, message, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      this.logger.error({ error, groupId: group.id }, 'Failed to notify group')
    }

    // Also send DM notification to the user
    try {
      const usePrivacy = config.privacyCashEnabled && !this.isDevnet
      const sweepMethod = usePrivacy
        ? `\n\n🔒 <i>Using Privacy Cash for enhanced privacy. Your deposit will be privately routed to the group pot.</i>`
        : ''

      const dmMessage = `✅ <b>Deposit Confirmed!</b>

Your deposit of <b>${solAmount} SOL</b> has been received!

<b>📊 Your Stats:</b>
• Your total deposits: <b>${(Number(member.deposits) / LAMPORTS_PER_SOL).toFixed(4)} SOL</b>
• Your ownership: <b>${ownershipPercent}%</b>

The funds will be swept to the group pot automatically.${sweepMethod}`

      await this.bot.api.sendMessage(member.telegramUserId, dmMessage, {
        parse_mode: 'HTML',
      })
    }
    catch (error) {
      // User may not have started the bot in DM, that's ok
      this.logger.debug({ error, userId: member.telegramUserId }, 'Failed to DM user about deposit (user may not have started bot)')
    }
  }

  private async sweepToMainPot(
    group: { id: string, telegramGroupId: string, walletAddress: string },
    member: {
      id: string
      depositAddress: string
      encryptedPrivateKey: string
      encryptionIv: string
    },
    depositAmount: bigint,
    depositSignature: string,
    isPrivacyFallback: boolean = false,
  ) {
    if (!this.walletService) {
      this.logger.warn('Wallet service not set, cannot sweep funds')
      return
    }

    try {
      // Restore the user's deposit wallet
      const userWallet = this.walletService.restoreWallet(
        member.encryptedPrivateKey,
        member.encryptionIv,
      )

      const groupPublicKey = new PublicKey(group.walletAddress)

      // Get balance with retry logic
      const balance = await this.rateLimiter.executeWithRetry(
        () => this.connection.getBalance(userWallet.publicKey),
        'getBalance',
      )

      // Calculate amount to send (leave some for rent exemption)
      const rentExemption = 890880 // ~0.0009 SOL minimum for account
      const txFee = 5000 // 5000 lamports for tx fee
      const minSweepAmount = 100000 // Minimum 0.0001 SOL to make sweep worthwhile
      const amountBeforeFee = BigInt(balance) - BigInt(rentExemption) - BigInt(txFee)

      // Calculate commission (0.15%)
      const feeAmount = (amountBeforeFee * BigInt(COMMISSION_RATE_BPS)) / 10000n
      const netAmount = amountBeforeFee - feeAmount

      if (amountBeforeFee < minSweepAmount) {
        const solBalance = (Number(balance) / LAMPORTS_PER_SOL).toFixed(6)
        this.logger.warn(
          { balance, memberId: member.id, depositSignature },
          'Deposit too small to sweep (less than 0.0001 SOL after fees)',
        )

        // Notify group that sweep was skipped
        if (this.bot) {
          const message = `⚠️ <b>Sweep Skipped</b>

Deposit of <b>${solBalance} SOL</b> is too small to sweep after accounting for rent and fees.

Minimum deposit for auto-sweep: <b>0.001 SOL</b>

The deposit is still recorded in your balance!`

          try {
            await this.bot.api.sendMessage(group.telegramGroupId, message, {
              parse_mode: 'HTML',
            })
          }
          catch (error) {
            this.logger.error({ error }, 'Failed to notify about skipped sweep')
          }
        }
        return
      }

      // Create transfer transaction with commission
      const transaction = new Transaction()

      // Add transfer to group pot (net amount)
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: userWallet.publicKey,
          toPubkey: groupPublicKey,
          lamports: netAmount,
        }),
      )

      // Add commission transfer to operator wallet
      // Only add if we have enough balance and operator wallet is configured
      let commissionIncluded = false
      let actualCommissionAmount = feeAmount
      if (config.operatorFeeWalletAddress && feeAmount > 0n) {
        // Check if operator wallet exists on-chain
        const operatorPubkey = new PublicKey(config.operatorFeeWalletAddress)
        const operatorAccountInfo = await this.rateLimiter.executeWithRetry(
          () => this.connection.getAccountInfo(operatorPubkey),
          'getAccountInfo',
        )
        const operatorAccountExists = operatorAccountInfo !== null

        // If operator account doesn't exist, we need to send at least rent-exempt minimum
        const RENT_EXEMPTION = 890880n
        const minTransferAmount = operatorAccountExists ? 0n : RENT_EXEMPTION
        actualCommissionAmount = feeAmount > minTransferAmount ? feeAmount : minTransferAmount

        // Verify we have enough balance for both transfers
        // Note: netAmount already calculated without considering increased commission for rent
        const totalTransfer = netAmount + actualCommissionAmount
        if (totalTransfer <= amountBeforeFee) {
          transaction.add(
            SystemProgram.transfer({
              fromPubkey: userWallet.publicKey,
              toPubkey: operatorPubkey,
              lamports: actualCommissionAmount,
            }),
          )
          commissionIncluded = true

          // Log if we're sending more than calculated fee to cover rent
          if (actualCommissionAmount > feeAmount) {
            this.logger.info(
              {
                feeAmount: feeAmount.toString(),
                actualCommissionAmount: actualCommissionAmount.toString(),
                memberId: member.id,
              },
              'Sending rent-exempt minimum for commission (higher than 0.15% to create operator account)',
            )
          }
        }
        else {
          // Not enough balance - either skip commission or reduce net amount
          // Let's try reducing net amount to accommodate commission with rent
          const adjustedNetAmount = amountBeforeFee - actualCommissionAmount
          if (adjustedNetAmount > 0n) {
            // Adjust the net transfer amount
            // Remove the previous net transfer instruction and add new one
            transaction.instructions = [
              SystemProgram.transfer({
                fromPubkey: userWallet.publicKey,
                toPubkey: groupPublicKey,
                lamports: adjustedNetAmount,
              }),
              SystemProgram.transfer({
                fromPubkey: userWallet.publicKey,
                toPubkey: operatorPubkey,
                lamports: actualCommissionAmount,
              }),
            ]
            commissionIncluded = true

            this.logger.info(
              {
                originalNetAmount: netAmount.toString(),
                adjustedNetAmount: adjustedNetAmount.toString(),
                actualCommissionAmount: actualCommissionAmount.toString(),
                memberId: member.id,
              },
              'Adjusted net amount to accommodate rent-exempt commission',
            )
          }
          else {
            // Not enough balance even with adjustment - skip commission
            this.logger.warn(
              {
                netAmount: netAmount.toString(),
                feeAmount: feeAmount.toString(),
                actualCommissionAmount: actualCommissionAmount.toString(),
                amountBeforeFee: amountBeforeFee.toString(),
                memberId: member.id,
              },
              'Commission calculation error: not enough balance even with adjustment, skipping commission',
            )
          }
        }
      }

      // Get recent blockhash with retry logic
      const { blockhash } = await this.rateLimiter.executeWithRetry(
        () => this.connection.getLatestBlockhash(),
        'getLatestBlockhash',
      )
      transaction.recentBlockhash = blockhash
      transaction.feePayer = userWallet.publicKey

      // Sign and send
      transaction.sign(userWallet)
      const sweepSignature = await this.connection.sendRawTransaction(
        transaction.serialize(),
      )

      // Wait for confirmation
      await this.connection.confirmTransaction(sweepSignature, 'confirmed')

      // Record commission if fee was actually included in the transaction
      if (config.operatorFeeWalletAddress && actualCommissionAmount > 0n && commissionIncluded) {
        try {
          await this.prisma.commission.create({
            data: {
              type: 'deposit',
              amountIn: amountBeforeFee,
              feeAmount: actualCommissionAmount, // Record actual amount sent (may include rent)
              rateBps: COMMISSION_RATE_BPS,
              operatorWallet: config.operatorFeeWalletAddress,
              transactionSignature: sweepSignature,
              linkedSignature: depositSignature,
              groupId: group.id,
            },
          })
        }
        catch (error) {
          this.logger.error({ error }, 'Failed to record commission')
        }
      }

      // Update deposit record with sweep info
      await this.prisma.deposit.update({
        where: { transactionSignature: depositSignature },
        data: { sweptAt: new Date() },
      })

      this.logger.info(
        {
          memberId: member.id,
          depositSignature,
          sweepSignature,
          amount: netAmount,
          feeAmount: feeAmount.toString(),
        },
        'Funds swept to main pot',
      )

      // Notify group of successful sweep
      if (this.bot) {
        const solAmount = (Number(netAmount) / LAMPORTS_PER_SOL).toFixed(4)
        const solFee = feeAmount > 0n ? (Number(feeAmount) / LAMPORTS_PER_SOL).toFixed(6) : '0'
        const explorerUrl = this.getExplorerUrl(sweepSignature)

        let message: string

        if (isPrivacyFallback) {
          // Privacy Cash failed, using regular transfer
          message = `⚠️ <b>Privacy Transfer Failed</b>

Privacy Cash encountered an error. Your deposit has been processed via regular transfer instead.

<b>${solAmount} SOL</b> transferred to main pot`
        }
        else {
          // Regular sweep (no Privacy Cash attempt)
          message = `✅ <b>Sweep Complete!</b>

<b>${solAmount} SOL</b> transferred to main pot`
        }

        if (feeAmount > 0n) {
          message += `

Commission (0.15%): <b>${solFee} SOL</b> → Operator`
        }

        message += `

<a href="${explorerUrl}">View on Solscan</a>`

        try {
          await this.bot.api.sendMessage(group.telegramGroupId, message, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          })
        }
        catch (error) {
          this.logger.error({ error }, 'Failed to notify sweep completion')
        }
      }
    }
    catch (error) {
      this.logger.error(
        { error, memberId: member.id, depositSignature },
        'Failed to sweep funds',
      )
    }
  }

  /**
   * Queue a deposit for private sweep via Privacy Cash
   * 1. Deposit to Privacy Cash pool
   * 2. Create pending sweep record with scheduled withdrawal time
   * 3. Background processor will handle split withdrawals later
   */
  private async queuePrivateSweep(
    group: { id: string, telegramGroupId: string, walletAddress: string },
    member: {
      id: string
      depositAddress: string
      encryptedPrivateKey: string
      encryptionIv: string
    },
    depositAmount: bigint,
    depositSignature: string,
  ) {
    if (!this.walletService) {
      this.logger.warn('Wallet service not set, cannot queue private sweep')
      return
    }

    try {
      // Restore the user's deposit wallet
      const userWallet = this.walletService.restoreWallet(
        member.encryptedPrivateKey,
        member.encryptionIv,
      )
      const userPrivateKeyBase58 = bs58.encode(userWallet.secretKey)

      // Get balance
      const balance = await this.rateLimiter.executeWithRetry(
        () => this.connection.getBalance(userWallet.publicKey),
        'getBalance',
      )

      // Calculate amount available for deposit to Privacy Cash
      // Privacy Cash requires extra lamports for:
      // - Nullifier PDA rent (~890,880 lamports per PDA, 2 PDAs created)
      // - Transaction fees and compute budget
      // - Relayer submission overhead
      const rentExemption = 890880
      const txFee = 5000
      const privacyCashBuffer = 2000000 // 0.002 SOL buffer for Privacy Cash internal costs
      const minAmount = 10000000 // Minimum 0.01 SOL (Privacy Cash minimum withdrawal)
      const availableAmount = BigInt(balance) - BigInt(rentExemption) - BigInt(txFee) - BigInt(privacyCashBuffer)

      if (availableAmount < minAmount) {
        this.logger.warn(
          { balance, memberId: member.id, depositSignature },
          'Amount too small for private sweep, falling back to regular sweep',
        )
        await this.sweepToMainPot(group, member, depositAmount, depositSignature, true)
        return
      }

      this.logger.info(
        {
          memberId: member.id,
          depositSignature,
          availableAmount: availableAmount.toString(),
        },
        'Depositing to Privacy Cash pool',
      )

      // Deposit to Privacy Cash
      const privacyCashConfig = {
        rpcUrl: config.solanaRpcUrl,
        ownerPrivateKey: userPrivateKeyBase58,
      }

      const depositResult = await this.privacyCashService.deposit(
        privacyCashConfig,
        availableAmount,
      )

      // Calculate scheduled withdrawal time (2-5 minutes delay for UTXO registration)
      const scheduledWithdrawAt = this.privacyCashService.getScheduledWithdrawTime()

      // Create pending sweep record
      await this.prisma.pendingPrivateSweep.create({
        data: {
          groupId: group.id,
          memberId: member.id,
          depositSignature,
          amount: availableAmount,
          status: 'deposited',
          depositTxSignature: depositResult.signature,
          scheduledWithdrawAt,
        },
      })

      this.logger.info(
        {
          memberId: member.id,
          depositSignature,
          depositTxSignature: depositResult.signature,
          scheduledWithdrawAt,
        },
        'Privacy Cash deposit queued for split withdrawal',
      )

      // Notify group that private sweep is in progress
      if (this.bot) {
        const solAmount = (Number(availableAmount) / LAMPORTS_PER_SOL).toFixed(4)
        const delayMinutes = Math.ceil((scheduledWithdrawAt.getTime() - Date.now()) / 60000)

        const message = `🔒 <b>Private Sweep Initiated</b>

<b>${solAmount} SOL</b> deposited to Privacy Cash pool.

Split withdrawals will complete in ~${delayMinutes} minutes.

<i>Your deposit is being privately routed to the group pot.</i>`

        try {
          await this.bot.api.sendMessage(group.telegramGroupId, message, {
            parse_mode: 'HTML',
          })
        }
        catch (error) {
          this.logger.error({ error }, 'Failed to notify about private sweep')
        }
      }
    }
    catch (error) {
      this.logger.error(
        { error, memberId: member.id, depositSignature },
        'Failed to queue private sweep, falling back to regular sweep',
      )

      // Fallback to regular sweep with privacy failure notification
      await this.sweepToMainPot(group, member, depositAmount, depositSignature, true)
    }
  }
}
