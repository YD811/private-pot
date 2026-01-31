import type { PrismaClient } from '@prisma/client'
import type { GroupService } from './group.js'
import type { IJupiterService } from './jupiter-interface.js'
import type { TokenBalanceService } from './token-balance.js'

export class DailyPnLService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly groupService: GroupService,
    private readonly jupiterService: IJupiterService,
    private readonly tokenBalanceService: TokenBalanceService,
  ) {}

  /**
   * Record daily PnL snapshot for a group
   */
  async recordDailyPnL(groupId: string, date: Date = new Date()): Promise<void> {
    // Calculate current PnL
    const pnl = await this.groupService.calculateGroupPnL(
      groupId,
      this.jupiterService,
      this.tokenBalanceService,
    )

    // Normalize date to start of day (UTC)
    const dateOnly = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))

    // Upsert daily PnL record
    await this.prisma.dailyPnL.upsert({
      where: {
        groupId_date: {
          groupId,
          date: dateOnly,
        },
      },
      create: {
        groupId,
        date: dateOnly,
        totalDeposits: pnl.totalDeposits,
        currentValue: pnl.currentValue,
        pnlAmount: pnl.pnlAmount,
        pnlPercent: pnl.pnlPercent,
        solBalance: pnl.solBalance,
      },
      update: {
        totalDeposits: pnl.totalDeposits,
        currentValue: pnl.currentValue,
        pnlAmount: pnl.pnlAmount,
        pnlPercent: pnl.pnlPercent,
        solBalance: pnl.solBalance,
      },
    })
  }

  /**
   * Record daily PnL for all groups
   */
  async recordDailyPnLForAllGroups(date: Date = new Date()): Promise<void> {
    const groups = await this.prisma.group.findMany({
      select: { id: true },
    })

    for (const group of groups) {
      try {
        await this.recordDailyPnL(group.id, date)
      }
      catch (error) {
        // Log error but continue with other groups
        console.error(`Failed to record daily PnL for group ${group.id}:`, error)
      }
    }
  }

  /**
   * Get daily PnL history for a group
   */
  async getDailyPnLHistory(
    groupId: string,
    days: number = 30,
  ): Promise<Array<{
      date: Date
      pnlAmount: bigint
      pnlPercent: number
      currentValue: bigint
    }>> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const records = await this.prisma.dailyPnL.findMany({
      where: {
        groupId,
        date: {
          gte: cutoffDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
      select: {
        date: true,
        pnlAmount: true,
        pnlPercent: true,
        currentValue: true,
      },
    })

    return records
  }

  /**
   * Get latest PnL snapshot for a group
   */
  async getLatestPnL(groupId: string): Promise<{
    date: Date
    pnlAmount: bigint
    pnlPercent: number
    currentValue: bigint
  } | null> {
    const record = await this.prisma.dailyPnL.findFirst({
      where: { groupId },
      orderBy: { date: 'desc' },
      select: {
        date: true,
        pnlAmount: true,
        pnlPercent: true,
        currentValue: true,
      },
    })

    return record
  }
}
