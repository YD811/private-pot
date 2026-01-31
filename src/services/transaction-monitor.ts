import type { PrismaClient } from '@prisma/client'
import type { Connection, ParsedTransactionWithMeta, PublicKey } from '@solana/web3.js'

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// TODO: This service needs to be updated for the new unique deposit address system
// Currently, it's designed for the old memo-based deposit code system
export class TransactionMonitorService {
  private processedSignatures = new Set<string>()

  constructor(
    private readonly connection: Connection,
    private readonly prisma: PrismaClient,
  ) {}

  extractMemoFromTransaction(tx: ParsedTransactionWithMeta): string | null {
    const instructions = tx.transaction.message.instructions

    for (const instruction of instructions) {
      if ('programId' in instruction && instruction.programId.toBase58() === MEMO_PROGRAM_ID) {
        if ('parsed' in instruction && typeof instruction.parsed === 'string') {
          return instruction.parsed
        }
      }
    }

    return null
  }

  getTransactionAmount(tx: ParsedTransactionWithMeta, recipientAddress: string): bigint {
    const accountKeys = tx.transaction.message.accountKeys
    const recipientIndex = accountKeys.findIndex(
      (key: any) => key.pubkey.toBase58() === recipientAddress,
    )

    if (recipientIndex === -1) {
      return 0n
    }

    const preBalance = tx.meta?.preBalances[recipientIndex] ?? 0
    const postBalance = tx.meta?.postBalances[recipientIndex] ?? 0

    const difference = postBalance - preBalance

    return difference > 0 ? BigInt(difference) : 0n
  }

  // TODO: Update this method for unique deposit addresses
  async processDeposit(
    depositAddress: string,
    txSignature: string,
    amount: bigint,
  ): Promise<boolean> {
    // Find member by deposit address
    const member = await this.prisma.member.findUnique({
      where: { depositAddress },
    })

    if (!member) {
      return false
    }

    const existingDeposit = await this.prisma.deposit.findUnique({
      where: { transactionSignature: txSignature },
    })

    if (existingDeposit) {
      return false
    }

    await this.prisma.deposit.create({
      data: {
        groupId: member.groupId,
        memberId: member.id,
        depositCodeId: null,
        transactionSignature: txSignature,
        amount,
        detectedAt: new Date(),
      },
    })

    await this.prisma.member.update({
      where: { id: member.id },
      data: {
        deposits: {
          increment: amount,
        },
      },
    })

    await this.prisma.group.update({
      where: { id: member.groupId },
      data: {
        totalDeposits: {
          increment: amount,
        },
      },
    })

    return true
  }

  // TODO: Update this method for unique deposit addresses
  async monitorWallet(walletAddress: PublicKey, onDeposit?: (groupId: string) => Promise<void>) {
    const signatures = await this.connection.getSignaturesForAddress(walletAddress, { limit: 10 })

    for (const sigInfo of signatures) {
      if (this.processedSignatures.has(sigInfo.signature)) {
        continue
      }

      const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      })

      if (!tx) {
        continue
      }

      const amount = this.getTransactionAmount(tx, walletAddress.toBase58())
      if (amount <= 0n) {
        this.processedSignatures.add(sigInfo.signature)
        continue
      }

      const processed = await this.processDeposit(
        walletAddress.toBase58(),
        sigInfo.signature,
        amount,
      )

      if (processed && onDeposit) {
        const member = await this.prisma.member.findUnique({
          where: { depositAddress: walletAddress.toBase58() },
        })
        if (member) {
          await onDeposit(member.groupId)
        }
      }

      this.processedSignatures.add(sigInfo.signature)
    }
  }

  clearProcessedSignatures() {
    this.processedSignatures.clear()
  }
}
