import type { Group, Member, PrismaClient } from '@prisma/client'
import type { IJupiterService } from './jupiter-interface.js'
import type { TokenBalanceService } from './token-balance.js'
import type { WalletService } from './wallet.js'

export interface GroupPnL {
  totalDeposits: bigint
  currentValue: bigint
  pnlAmount: bigint
  pnlPercent: number
  solBalance: bigint
  tokenPositions: Array<{
    tokenAddress: string
    balance: bigint
    valueInSOL: bigint
  }>
}

export class GroupService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly walletService: WalletService,
  ) {}

  async getOrCreateGroup(telegramGroupId: string): Promise<Group> {
    const existing = await this.prisma.group.findUnique({
      where: { telegramGroupId },
    })

    if (existing) {
      return existing
    }

    const walletData = this.walletService.createGroupWallet(telegramGroupId)

    return this.prisma.group.create({
      data: {
        telegramGroupId,
        walletAddress: walletData.publicKey,
        encryptedPrivateKey: walletData.encryptedPrivateKey,
        encryptionIv: walletData.iv,
      },
    })
  }

  async getOrCreateMember(
    groupId: string,
    telegramUserId: string,
    telegramUsername?: string,
  ): Promise<Member> {
    const existing = await this.prisma.member.findUnique({
      where: {
        groupId_telegramUserId: {
          groupId,
          telegramUserId,
        },
      },
    })

    if (existing) {
      if (existing.telegramUsername !== telegramUsername && telegramUsername) {
        return this.prisma.member.update({
          where: { id: existing.id },
          data: { telegramUsername },
        })
      }
      return existing
    }

    const depositWallet = this.walletService.createUserDepositWallet(groupId, telegramUserId)

    return this.prisma.member.create({
      data: {
        groupId,
        telegramUserId,
        telegramUsername,
        depositAddress: depositWallet.publicKey,
        encryptedPrivateKey: depositWallet.encryptedPrivateKey,
        encryptionIv: depositWallet.iv,
      },
    })
  }

  async setTraderPermission(memberId: string, isTrader: boolean): Promise<Member> {
    return this.prisma.member.update({
      where: { id: memberId },
      data: { isTrader },
    })
  }

  async setTradeLimits(memberId: string, tradeLimit?: bigint, dailyLimit?: bigint): Promise<Member> {
    return this.prisma.member.update({
      where: { id: memberId },
      data: {
        tradeLimit: tradeLimit ?? undefined,
        dailyLimit: dailyLimit ?? undefined,
      },
    })
  }

  async toggleGroupPause(groupId: string, isPaused: boolean): Promise<Group> {
    return this.prisma.group.update({
      where: { id: groupId },
      data: { isPaused },
    })
  }

  async getMemberByTelegramId(groupId: string, telegramUserId: string): Promise<Member | null> {
    return this.prisma.member.findUnique({
      where: {
        groupId_telegramUserId: {
          groupId,
          telegramUserId,
        },
      },
    })
  }

  async getMembershipsWithDeposits(telegramUserId: string): Promise<(Member & { group: Group })[]> {
    return this.prisma.member.findMany({
      where: {
        telegramUserId,
        deposits: { gt: 0 },
      },
      include: { group: true },
    })
  }

  async getGroupBalance(groupId: string): Promise<bigint> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
    })

    if (!group) {
      return BigInt(0)
    }

    return this.walletService.getBalance(group.walletAddress)
  }

  /**
   * Get cached PnL for a group, or calculate if cache is stale
   *
   * @param groupId - The group ID
   * @param pnlCacheService - Optional PnL cache service to check cache first
   * @param jupiterService - Jupiter service for getting token quotes
   * @param tokenBalanceService - Token balance service for getting on-chain balances
   * @returns GroupPnL object with PnL calculations
   */
  async getGroupPnL(
    groupId: string,
    pnlCacheService: { getCachedPnL: (groupId: string) => Promise<GroupPnL | null> } | null,
    jupiterService: IJupiterService,
    tokenBalanceService: TokenBalanceService,
  ): Promise<GroupPnL> {
    // Try to get from cache first
    if (pnlCacheService) {
      const cached = await pnlCacheService.getCachedPnL(groupId)
      if (cached) {
        return cached
      }
    }

    // Cache miss or stale, calculate fresh
    return this.calculateGroupPnL(groupId, jupiterService, tokenBalanceService)
  }

  /**
   * Calculate Profit and Loss (PnL) for a group
   *
   * PnL = Current Value - Total Deposits
   * Current Value = SOL Balance + (all token positions converted to SOL)
   *
   * @param groupId - The group ID
   * @param jupiterService - Jupiter service for getting token quotes
   * @param tokenBalanceService - Token balance service for getting on-chain balances
   * @returns GroupPnL object with PnL calculations
   */
  async calculateGroupPnL(
    groupId: string,
    jupiterService: IJupiterService,
    tokenBalanceService: TokenBalanceService,
  ): Promise<GroupPnL> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        positions: true,
      },
    })

    if (!group) {
      throw new Error(`Group ${groupId} not found`)
    }

    // Get SOL balance
    const solBalance = await this.walletService.getBalance(group.walletAddress)

    // Get all positions
    const positions = await this.prisma.position.findMany({
      where: { groupId: group.id },
    })

    // Calculate total current value
    let totalCurrentValue = solBalance
    const tokenPositions: GroupPnL['tokenPositions'] = []

    // For each token position, get its current value in SOL
    for (const position of positions) {
      try {
        // Get on-chain balance (more accurate than database balance)
        const onChainBalance = await tokenBalanceService.getTokenBalance(
          group.walletAddress,
          position.tokenAddress,
        )

        if (onChainBalance.amount === 0n) {
          continue // Skip positions with zero balance
        }

        // Get token info for decimals
        const tokenInfo = await jupiterService.getTokenInfo(position.tokenAddress)
        if (!tokenInfo) {
          continue // Skip if we can't get token info
        }

        // Get quote to convert token to SOL
        // Use a reasonable amount for the quote (the actual balance)
        const quote = await jupiterService.getQuote(
          position.tokenAddress,
          'So11111111111111111111111111111111111111112', // SOL
          Number(onChainBalance.amount),
          50, // 0.5% slippage
        )

        // Quote gives us SOL amount we'd receive for this token balance
        const valueInSOL = BigInt(quote.outAmount)
        totalCurrentValue += valueInSOL

        tokenPositions.push({
          tokenAddress: position.tokenAddress,
          balance: onChainBalance.amount,
          valueInSOL,
        })
      }
      catch (error) {
        // If we can't get quote or balance, skip this position
        // Log error but don't fail the entire calculation
        console.warn(`Failed to calculate value for position ${position.tokenAddress}:`, error)
      }
    }

    // Calculate PnL
    const totalDeposits = group.totalDeposits
    const pnlAmount = totalCurrentValue - totalDeposits
    const pnlPercent = totalDeposits > 0n
      ? (Number(pnlAmount) / Number(totalDeposits)) * 100
      : 0

    return {
      totalDeposits,
      currentValue: totalCurrentValue,
      pnlAmount,
      pnlPercent,
      solBalance,
      tokenPositions,
    }
  }
}
