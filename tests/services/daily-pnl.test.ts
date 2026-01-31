import type { GroupPnL, GroupService } from '#root/services/group.js'
import type { IJupiterService } from '#root/services/jupiter-interface.js'
import type { TokenBalanceService } from '#root/services/token-balance.js'
import type { PrismaClient } from '@prisma/client'
import { DailyPnLService } from '#root/services/daily-pnl.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createMockGroupService() {
  return {
    calculateGroupPnL: vi.fn(),
  } as any
}

describe('dailyPnLService', () => {
  let mockPrisma: PrismaClient
  let mockGroupService: GroupService
  let mockJupiterService: IJupiterService
  let mockTokenBalanceService: TokenBalanceService
  let dailyPnLService: DailyPnLService

  beforeEach(() => {
    mockPrisma = {
      group: {
        findMany: vi.fn(),
      },
      dailyPnL: {
        upsert: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    } as any

    mockGroupService = createMockGroupService()
    mockJupiterService = {} as any
    mockTokenBalanceService = {} as any

    dailyPnLService = new DailyPnLService(
      mockPrisma,
      mockGroupService,
      mockJupiterService,
      mockTokenBalanceService,
    )
  })

  describe('recordDailyPnL', () => {
    it('records daily PnL snapshot for a group', async () => {
      const groupId = 'group-1'
      const mockPnL: GroupPnL = {
        totalDeposits: BigInt(10_000_000_000),
        currentValue: BigInt(12_000_000_000),
        pnlAmount: BigInt(2_000_000_000),
        pnlPercent: 20,
        solBalance: BigInt(8_000_000_000),
        tokenPositions: [],
      }

      vi.mocked(mockGroupService.calculateGroupPnL).mockResolvedValue(mockPnL)
      vi.mocked(mockPrisma.dailyPnL.upsert).mockResolvedValue({
        id: 'pnl-1',
        groupId,
        date: new Date(),
        totalDeposits: mockPnL.totalDeposits,
        currentValue: mockPnL.currentValue,
        pnlAmount: mockPnL.pnlAmount,
        pnlPercent: mockPnL.pnlPercent,
        solBalance: mockPnL.solBalance,
        createdAt: new Date(),
      } as any)

      const date = new Date('2025-01-15T10:30:00Z')
      await dailyPnLService.recordDailyPnL(groupId, date)

      expect(mockGroupService.calculateGroupPnL).toHaveBeenCalledWith(
        groupId,
        mockJupiterService,
        mockTokenBalanceService,
      )

      const expectedDate = new Date(Date.UTC(2025, 0, 15, 0, 0, 0, 0))
      expect(mockPrisma.dailyPnL.upsert).toHaveBeenCalledWith({
        where: {
          groupId_date: {
            groupId,
            date: expectedDate,
          },
        },
        create: {
          groupId,
          date: expectedDate,
          totalDeposits: mockPnL.totalDeposits,
          currentValue: mockPnL.currentValue,
          pnlAmount: mockPnL.pnlAmount,
          pnlPercent: mockPnL.pnlPercent,
          solBalance: mockPnL.solBalance,
        },
        update: {
          totalDeposits: mockPnL.totalDeposits,
          currentValue: mockPnL.currentValue,
          pnlAmount: mockPnL.pnlAmount,
          pnlPercent: mockPnL.pnlPercent,
          solBalance: mockPnL.solBalance,
        },
      })
    })

    it('updates existing daily PnL record if it exists', async () => {
      const groupId = 'group-1'
      const mockPnL: GroupPnL = {
        totalDeposits: BigInt(10_000_000_000),
        currentValue: BigInt(11_000_000_000),
        pnlAmount: BigInt(1_000_000_000),
        pnlPercent: 10,
        solBalance: BigInt(9_000_000_000),
        tokenPositions: [],
      }

      vi.mocked(mockGroupService.calculateGroupPnL).mockResolvedValue(mockPnL)
      vi.mocked(mockPrisma.dailyPnL.upsert).mockResolvedValue({
        id: 'pnl-1',
        groupId,
        date: new Date(),
        ...mockPnL,
        createdAt: new Date(),
      } as any)

      await dailyPnLService.recordDailyPnL(groupId)

      expect(mockPrisma.dailyPnL.upsert).toHaveBeenCalled()
      const call = vi.mocked(mockPrisma.dailyPnL.upsert).mock.calls[0]
      expect(call[0].update).toBeDefined()
    })
  })

  describe('recordDailyPnLForAllGroups', () => {
    it('records daily PnL for all groups', async () => {
      const groups = [
        { id: 'group-1' },
        { id: 'group-2' },
      ]

      vi.mocked(mockPrisma.group.findMany).mockResolvedValue(groups as any)

      const mockPnL: GroupPnL = {
        totalDeposits: BigInt(5_000_000_000),
        currentValue: BigInt(6_000_000_000),
        pnlAmount: BigInt(1_000_000_000),
        pnlPercent: 20,
        solBalance: BigInt(5_000_000_000),
        tokenPositions: [],
      }

      vi.mocked(mockGroupService.calculateGroupPnL)
        .mockResolvedValueOnce(mockPnL)
        .mockResolvedValueOnce(mockPnL)

      vi.mocked(mockPrisma.dailyPnL.upsert).mockResolvedValue({
        id: 'pnl-1',
        groupId: 'group-1',
        date: new Date(),
        ...mockPnL,
        createdAt: new Date(),
      } as any)

      await dailyPnLService.recordDailyPnLForAllGroups()

      expect(mockPrisma.group.findMany).toHaveBeenCalledWith({
        select: { id: true },
      })
      expect(mockGroupService.calculateGroupPnL).toHaveBeenCalledTimes(2)
      expect(mockPrisma.dailyPnL.upsert).toHaveBeenCalledTimes(2)
    })

    it('continues processing other groups if one fails', async () => {
      const groups = [
        { id: 'group-1' },
        { id: 'group-2' },
      ]

      vi.mocked(mockPrisma.group.findMany).mockResolvedValue(groups as any)

      const mockPnL: GroupPnL = {
        totalDeposits: BigInt(5_000_000_000),
        currentValue: BigInt(6_000_000_000),
        pnlAmount: BigInt(1_000_000_000),
        pnlPercent: 20,
        solBalance: BigInt(5_000_000_000),
        tokenPositions: [],
      }

      // First group fails, second succeeds
      vi.mocked(mockGroupService.calculateGroupPnL)
        .mockRejectedValueOnce(new Error('Failed to calculate'))
        .mockResolvedValueOnce(mockPnL)

      vi.mocked(mockPrisma.dailyPnL.upsert).mockResolvedValue({
        id: 'pnl-1',
        groupId: 'group-2',
        date: new Date(),
        ...mockPnL,
        createdAt: new Date(),
      } as any)

      await dailyPnLService.recordDailyPnLForAllGroups()

      // Should still process the second group
      expect(mockGroupService.calculateGroupPnL).toHaveBeenCalledTimes(2)
      expect(mockPrisma.dailyPnL.upsert).toHaveBeenCalledTimes(1)
    })
  })

  describe('getDailyPnLHistory', () => {
    it('returns daily PnL history for a group', async () => {
      const groupId = 'group-1'
      const mockRecords = [
        {
          date: new Date('2025-01-15'),
          pnlAmount: BigInt(1_000_000_000),
          pnlPercent: 10,
          currentValue: BigInt(11_000_000_000),
        },
        {
          date: new Date('2025-01-16'),
          pnlAmount: BigInt(2_000_000_000),
          pnlPercent: 20,
          currentValue: BigInt(12_000_000_000),
        },
      ]

      vi.mocked(mockPrisma.dailyPnL.findMany).mockResolvedValue(mockRecords as any)

      const result = await dailyPnLService.getDailyPnLHistory(groupId, 30)

      expect(mockPrisma.dailyPnL.findMany).toHaveBeenCalledWith({
        where: {
          groupId,
          date: {
            gte: expect.any(Date),
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

      expect(result).toEqual(mockRecords)
    })

    it('respects the days parameter', async () => {
      const groupId = 'group-1'
      vi.mocked(mockPrisma.dailyPnL.findMany).mockResolvedValue([])

      await dailyPnLService.getDailyPnLHistory(groupId, 7)

      const call = vi.mocked(mockPrisma.dailyPnL.findMany).mock.calls[0]
      const whereClause = call?.[0]?.where
      const cutoffDate = whereClause && typeof whereClause === 'object' && 'date' in whereClause
        ? (whereClause.date as any)?.gte as Date
        : null

      expect(cutoffDate).not.toBeNull()
      if (cutoffDate) {
        const now = new Date()
        const expectedCutoff = new Date()
        expectedCutoff.setDate(now.getDate() - 7)

        // Check that cutoff date is approximately 7 days ago (within 1 hour tolerance)
        const diff = Math.abs(cutoffDate.getTime() - expectedCutoff.getTime())
        expect(diff).toBeLessThan(60 * 60 * 1000) // 1 hour
      }
    })
  })

  describe('getLatestPnL', () => {
    it('returns latest PnL snapshot for a group', async () => {
      const groupId = 'group-1'
      const mockRecord = {
        date: new Date('2025-01-15'),
        pnlAmount: BigInt(2_000_000_000),
        pnlPercent: 20,
        currentValue: BigInt(12_000_000_000),
      }

      vi.mocked(mockPrisma.dailyPnL.findFirst).mockResolvedValue(mockRecord as any)

      const result = await dailyPnLService.getLatestPnL(groupId)

      expect(mockPrisma.dailyPnL.findFirst).toHaveBeenCalledWith({
        where: { groupId },
        orderBy: { date: 'desc' },
        select: {
          date: true,
          pnlAmount: true,
          pnlPercent: true,
          currentValue: true,
        },
      })

      expect(result).toEqual(mockRecord)
    })

    it('returns null when no PnL records exist', async () => {
      const groupId = 'group-1'
      vi.mocked(mockPrisma.dailyPnL.findFirst).mockResolvedValue(null)

      const result = await dailyPnLService.getLatestPnL(groupId)

      expect(result).toBeNull()
    })
  })
})
