import type { Logger } from '#root/logger.js'
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { PrivacyCash } from 'privacycash'

// Privacy Cash fees: 0.35% + 0.006 SOL on withdrawals
const WITHDRAWAL_FEE_RATE_BPS = 35 // 0.35%
const WITHDRAWAL_FIXED_FEE_LAMPORTS = 6_000_000n // 0.006 SOL

export interface PrivacyCashConfig {
  rpcUrl: string
  ownerPrivateKey: string // Base58 encoded
}

export interface SplitWithdrawalResult {
  withdraw1Signature: string
  withdraw2Signature: string
  tempWallet1: string
  tempWallet2: string
  amount1: bigint
  amount2: bigint
}

export class PrivacyCashService {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * Create a PrivacyCash client instance for a specific wallet
   */
  private createClient(rpcUrl: string, ownerPrivateKey: string): PrivacyCash {
    return new PrivacyCash({
      RPC_url: rpcUrl,
      owner: ownerPrivateKey,
    })
  }

  /**
   * Get the private balance in Privacy Cash pool
   */
  async getPrivateBalance(config: PrivacyCashConfig): Promise<bigint> {
    const client = this.createClient(config.rpcUrl, config.ownerPrivateKey)
    const result = await client.getPrivateBalance()
    return BigInt(result.lamports)
  }

  /**
   * Deposit funds to Privacy Cash pool
   */
  async deposit(config: PrivacyCashConfig, lamports: bigint): Promise<{ signature: string }> {
    const client = this.createClient(config.rpcUrl, config.ownerPrivateKey)

    this.logger.info(
      { amount: Number(lamports) / LAMPORTS_PER_SOL },
      'Depositing to Privacy Cash pool',
    )

    const result = await client.deposit({ lamports: Number(lamports) })

    this.logger.info(
      { signature: result.tx },
      'Privacy Cash deposit completed',
    )

    return { signature: result.tx }
  }

  /**
   * Withdraw from Privacy Cash to a recipient address
   */
  async withdraw(
    config: PrivacyCashConfig,
    lamports: bigint,
    recipientAddress: string,
  ): Promise<{ signature: string }> {
    const client = this.createClient(config.rpcUrl, config.ownerPrivateKey)

    this.logger.info(
      {
        amount: Number(lamports) / LAMPORTS_PER_SOL,
        recipient: recipientAddress,
      },
      'Withdrawing from Privacy Cash',
    )

    const result = await client.withdraw({
      lamports: Number(lamports),
      recipientAddress,
    })

    this.logger.info(
      { signature: result.tx, recipient: recipientAddress },
      'Privacy Cash withdrawal completed',
    )

    return { signature: result.tx }
  }

  /**
   * Generate two temporary wallets for split withdrawal
   */
  generateTempWallets(): { wallet1: Keypair, wallet2: Keypair } {
    const wallet1 = Keypair.generate()
    const wallet2 = Keypair.generate()

    this.logger.debug(
      {
        wallet1: wallet1.publicKey.toBase58(),
        wallet2: wallet2.publicKey.toBase58(),
      },
      'Generated temporary wallets for split withdrawal',
    )

    return { wallet1, wallet2 }
  }

  /**
   * Calculate withdrawal fee for a given amount
   * Privacy Cash charges 0.35% + 0.006 SOL
   */
  calculateWithdrawalFee(lamports: bigint): bigint {
    const percentageFee = (lamports * BigInt(WITHDRAWAL_FEE_RATE_BPS)) / 10000n
    return percentageFee + WITHDRAWAL_FIXED_FEE_LAMPORTS
  }

  /**
   * Calculate the split amounts for two withdrawals
   * Uses random-ish split (55-65% / 35-45%) to avoid pattern detection
   */
  calculateSplitAmounts(totalLamports: bigint): { amount1: bigint, amount2: bigint } {
    // Random split between 55-65% for first withdrawal
    const splitPercent = 55 + Math.floor(Math.random() * 11) // 55-65
    const amount1 = (totalLamports * BigInt(splitPercent)) / 100n
    const amount2 = totalLamports - amount1

    this.logger.debug(
      {
        total: totalLamports.toString(),
        amount1: amount1.toString(),
        amount2: amount2.toString(),
        splitPercent,
      },
      'Calculated split amounts',
    )

    return { amount1, amount2 }
  }

  /**
   * Calculate net amount after Privacy Cash fees for split withdrawal
   * Since we withdraw twice, we pay fees twice
   */
  calculateNetAfterFees(totalLamports: bigint): {
    netAmount: bigint
    totalFees: bigint
    amount1Net: bigint
    amount2Net: bigint
  } {
    const { amount1, amount2 } = this.calculateSplitAmounts(totalLamports)

    const fee1 = this.calculateWithdrawalFee(amount1)
    const fee2 = this.calculateWithdrawalFee(amount2)
    const totalFees = fee1 + fee2

    const amount1Net = amount1 - fee1
    const amount2Net = amount2 - fee2
    const netAmount = amount1Net + amount2Net

    return { netAmount, totalFees, amount1Net, amount2Net }
  }

  /**
   * Format fee info for display
   */
  formatFeeInfo(lamports: bigint): string {
    const { totalFees, netAmount } = this.calculateNetAfterFees(lamports)
    const feeInSol = Number(totalFees) / LAMPORTS_PER_SOL
    const netInSol = Number(netAmount) / LAMPORTS_PER_SOL
    const feePercent = (Number(totalFees) / Number(lamports)) * 100

    return `Privacy Cash fee: ${feeInSol.toFixed(6)} SOL (${feePercent.toFixed(2)}%) - Net: ${netInSol.toFixed(6)} SOL`
  }

  /**
   * Get the scheduled withdrawal time (delay after deposit)
   * Uses a random delay between 2-5 minutes to allow UTXO registration
   */
  getScheduledWithdrawTime(): Date {
    const minDelayMs = 2 * 60 * 1000 // 2 minutes
    const maxDelayMs = 5 * 60 * 1000 // 5 minutes
    const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs))

    const scheduledTime = new Date(Date.now() + delayMs)

    this.logger.debug(
      { scheduledTime, delayMs },
      'Calculated scheduled withdrawal time',
    )

    return scheduledTime
  }

  /**
   * Transfer from temp wallet to final destination
   */
  async transferFromTempWallet(
    connection: any,
    tempWallet: Keypair,
    destinationAddress: string,
    _lamports: bigint,
  ): Promise<{ signature: string }> {
    const destinationPubkey = new PublicKey(destinationAddress)

    // Get balance and calculate transfer amount (leave some for rent)
    const balance = await connection.getBalance(tempWallet.publicKey)
    const rentExemption = 890880
    const txFee = 5000
    const transferAmount = BigInt(balance) - BigInt(rentExemption) - BigInt(txFee)

    if (transferAmount <= 0n) {
      throw new Error(`Insufficient balance in temp wallet: ${balance} lamports`)
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tempWallet.publicKey,
        toPubkey: destinationPubkey,
        lamports: transferAmount,
      }),
    )

    const { blockhash } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = tempWallet.publicKey

    transaction.sign(tempWallet)
    const signature = await connection.sendRawTransaction(transaction.serialize())
    await connection.confirmTransaction(signature, 'confirmed')

    this.logger.info(
      {
        from: tempWallet.publicKey.toBase58(),
        to: destinationAddress,
        amount: transferAmount.toString(),
        signature,
      },
      'Transferred from temp wallet to destination',
    )

    return { signature }
  }

  /**
   * Encode a keypair to base58 for storage
   */
  encodeKeypair(keypair: Keypair): string {
    return bs58.encode(keypair.secretKey)
  }

  /**
   * Decode a keypair from base58
   */
  decodeKeypair(encoded: string): Keypair {
    return Keypair.fromSecretKey(bs58.decode(encoded))
  }
}
