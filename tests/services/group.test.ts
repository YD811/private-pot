import type { IJupiterService } from '#root/services/jupiter-interface.js'
import type { TokenBalanceService } from '#root/services/token-balance.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { GroupService } from '#root/services/group.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createMockGroup(overrides = {}) {
  return {
    id: 'group-1',
    telegramGroupId: '-1001234567890',
    walletAddress: 'wallet123',
    encryptedPrivateKey: 'encrypted',
    encryptionIv: 'iv123',
    ...overrides,
  }
}

function createMockMember(overrides = {}) {
  return {
    id: 'member-1',
    groupId: 'group-1',
    telegramUserId: '123456789',
    telegramUsername: 'testuser',
    depositAddress: 'UserDepositAddress123',
    ...overrides,
  }
}

describe('groupService', () => {
  let mockPrisma: PrismaClient
  let mockWalletService: WalletService
  let groupService: GroupService

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      member: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as any

    mockWalletService = {
      createGroupWallet: vi.fn().mockReturnValue({
        publicKey: 'TestPublicKey123',
        encryptedPrivateKey: 'encrypted',
        iv: 'iv123',
      }),
      createUserDepositWallet: vi.fn().mockReturnValue({
        publicKey: 'UserDepositAddress123',
        encryptedPrivateKey: 'encrypted-user',
        iv: 'iv-user',
      }),
      getBalance: vi.fn(),
    } as any

    groupService = new GroupService(mockPrisma, mockWalletService)
  })

  describe('getOrCreateGroup', () => {
    it('returns existing group when found in database', async () => {
      const existingGroup = createMockGroup()
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(existingGroup as any)

      const result = await groupService.getOrCreateGroup('-1001234567890')

      expect(result).toEqual(existingGroup)
      expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
        where: { telegramGroupId: '-1001234567890' },
      })
      expect(mockPrisma.group.create).not.toHaveBeenCalled()
    })

    it('creates new group with wallet when not found', async () => {
      const newGroup = createMockGroup({ id: 'group-new' })
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.group.create).mockResolvedValue(newGroup as any)

      const result = await groupService.getOrCreateGroup('-1001234567890')

      expect(mockWalletService.createGroupWallet).toHaveBeenCalledWith('-1001234567890')
      expect(mockPrisma.group.create).toHaveBeenCalledWith({
        data: {
          telegramGroupId: '-1001234567890',
          walletAddress: 'TestPublicKey123',
          encryptedPrivateKey: 'encrypted',
          encryptionIv: 'iv123',
        },
      })
      expect(result).toEqual(newGroup)
    })
  })

  describe('getOrCreateMember', () => {
    it('returns existing member when found in database', async () => {
      const existingMember = createMockMember()
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValue(existingMember as any)

      const result = await groupService.getOrCreateMember('group-1', '123456789', 'testuser')

      expect(result).toEqual(existingMember)
      expect(mockPrisma.member.findUnique).toHaveBeenCalledWith({
        where: {
          groupId_telegramUserId: {
            groupId: 'group-1',
            telegramUserId: '123456789',
          },
        },
      })
      expect(mockPrisma.member.create).not.toHaveBeenCalled()
    })

    it('creates new member with deposit wallet when not found', async () => {
      const newMember = createMockMember({ id: 'member-new' })
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.member.create).mockResolvedValue(newMember as any)

      const result = await groupService.getOrCreateMember('group-1', '123456789', 'testuser')

      expect(mockWalletService.createUserDepositWallet).toHaveBeenCalledWith('group-1', '123456789')
      expect(mockPrisma.member.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          telegramUserId: '123456789',
          telegramUsername: 'testuser',
          depositAddress: 'UserDepositAddress123',
          encryptedPrivateKey: 'encrypted-user',
          encryptionIv: 'iv-user',
        },
      })
      expect(result).toEqual(newMember)
    })

    it('creates member without username when not provided', async () => {
      const newMember = createMockMember({ id: 'member-new', telegramUsername: null })
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValue(null)
      vi.mocked(mockPrisma.member.create).mockResolvedValue(newMember as any)

      const result = await groupService.getOrCreateMember('group-1', '123456789')

      expect(mockWalletService.createUserDepositWallet).toHaveBeenCalledWith('group-1', '123456789')
      expect(mockPrisma.member.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          telegramUserId: '123456789',
          telegramUsername: undefined,
          depositAddress: 'UserDepositAddress123',
          encryptedPrivateKey: 'encrypted-user',
          encryptionIv: 'iv-user',
        },
      })
      expect(result).toEqual(newMember)
    })
  })

  describe('setTraderPermission', () => {
    it('grants trader permission to member', async () => {
      const updatedMember = createMockMember({ isTrader: true })
      vi.mocked(mockPrisma.member.update).mockResolvedValue(updatedMember as any)

      const result = await groupService.setTraderPermission('member-1', true)

      expect(mockPrisma.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isTrader: true },
      })
      expect(result.isTrader).toBe(true)
    })

    it('revokes trader permission from member', async () => {
      const updatedMember = createMockMember({ isTrader: false })
      vi.mocked(mockPrisma.member.update).mockResolvedValue(updatedMember as any)

      const result = await groupService.setTraderPermission('member-1', false)

      expect(mockPrisma.member.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: { isTrader: false },
      })
      expect(result.isTrader).toBe(false)
    })
  })

  describe('toggleGroupPause', () => {
    it('pauses trading for group', async () => {
      const updatedGroup = createMockGroup({ isPaused: true })
      vi.mocked(mockPrisma.group.update).mockResolvedValue(updatedGroup as any)

      const result = await groupService.toggleGroupPause('group-1', true)

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPaused: true },
      })
      expect(result.isPaused).toBe(true)
    })

    it('resumes trading for group', async () => {
      const updatedGroup = createMockGroup({ isPaused: false })
      vi.mocked(mockPrisma.group.update).mockResolvedValue(updatedGroup as any)

      const result = await groupService.toggleGroupPause('group-1', false)

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPaused: false },
      })
      expect(result.isPaused).toBe(false)
    })
  })

  describe('calculateGroupPnL', () => {
    let mockJupiterService: IJupiterService
    let mockTokenBalanceService: TokenBalanceService

    beforeEach(() => {
      mockJupiterService = {
        getQuote: vi.fn(),
        getTokenInfo: vi.fn(),
      } as any

      mockTokenBalanceService = {
        getTokenBalance: vi.fn(),
      } as any

      // Add position mock to prisma
      ;(mockPrisma as any).position = {
        findMany: vi.fn(),
      }
    })

    it('calculates PnL for group with only SOL (no positions)', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(2_000_000_000), // 2 SOL deposited
      })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions: [],
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue([])
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(2_500_000_000)) // 2.5 SOL current

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.totalDeposits).toBe(BigInt(2_000_000_000))
      expect(result.currentValue).toBe(BigInt(2_500_000_000))
      expect(result.pnlAmount).toBe(BigInt(500_000_000)) // 0.5 SOL profit
      expect(result.pnlPercent).toBe(25) // 25% gain
      expect(result.solBalance).toBe(BigInt(2_500_000_000))
      expect(result.tokenPositions).toEqual([])
    })

    it('calculates PnL for group with loss', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(5_000_000_000), // 5 SOL deposited
      })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions: [],
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue([])
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(3_000_000_000)) // 3 SOL current

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.totalDeposits).toBe(BigInt(5_000_000_000))
      expect(result.currentValue).toBe(BigInt(3_000_000_000))
      expect(result.pnlAmount).toBe(BigInt(-2_000_000_000)) // -2 SOL loss
      expect(result.pnlPercent).toBe(-40) // -40% loss
    })

    it('calculates PnL for group with token positions', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(10_000_000_000), // 10 SOL deposited
      })

      const tokenAddress = 'Token123'
      const positions = [
        {
          id: 'pos-1',
          groupId: 'group-1',
          tokenAddress,
          balance: BigInt(1000),
          costBasis: BigInt(1_000_000_000), // 1 SOL cost basis
        },
      ]

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions,
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue(positions as any)
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(9_000_000_000)) // 9 SOL

      // Mock token balance service
      vi.mocked(mockTokenBalanceService.getTokenBalance).mockResolvedValue({
        mint: tokenAddress,
        amount: BigInt(1000),
        decimals: 9,
      })

      // Mock Jupiter service
      vi.mocked(mockJupiterService.getTokenInfo).mockResolvedValue({
        address: tokenAddress,
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 9,
      })

      // Mock quote: 1000 tokens = 1.5 SOL
      vi.mocked(mockJupiterService.getQuote).mockResolvedValue({
        inAmount: '1000',
        outAmount: '1500000000', // 1.5 SOL in lamports
        priceImpactPct: 0.1,
      } as any)

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.totalDeposits).toBe(BigInt(10_000_000_000))
      expect(result.currentValue).toBe(BigInt(10_500_000_000)) // 9 SOL + 1.5 SOL from tokens
      expect(result.pnlAmount).toBe(BigInt(500_000_000)) // 0.5 SOL profit
      expect(result.pnlPercent).toBe(5) // 5% gain
      expect(result.tokenPositions).toHaveLength(1)
      expect(result.tokenPositions[0].tokenAddress).toBe(tokenAddress)
      expect(result.tokenPositions[0].valueInSOL).toBe(BigInt(1_500_000_000))
    })

    it('skips positions with zero balance', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(5_000_000_000),
      })

      const positions = [
        {
          id: 'pos-1',
          groupId: 'group-1',
          tokenAddress: 'Token123',
          balance: BigInt(1000),
          costBasis: BigInt(1_000_000_000),
        },
      ]

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions,
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue(positions as any)
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(4_000_000_000))

      // Mock zero balance
      vi.mocked(mockTokenBalanceService.getTokenBalance).mockResolvedValue({
        mint: 'Token123',
        amount: BigInt(0),
        decimals: 9,
      })

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.currentValue).toBe(BigInt(4_000_000_000)) // Only SOL, no tokens
      expect(result.tokenPositions).toHaveLength(0)
      expect(mockJupiterService.getQuote).not.toHaveBeenCalled()
    })

    it('handles multiple token positions', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(10_000_000_000),
      })

      const positions = [
        {
          id: 'pos-1',
          groupId: 'group-1',
          tokenAddress: 'Token1',
          balance: BigInt(1000),
          costBasis: BigInt(1_000_000_000),
        },
        {
          id: 'pos-2',
          groupId: 'group-1',
          tokenAddress: 'Token2',
          balance: BigInt(2000),
          costBasis: BigInt(2_000_000_000),
        },
      ]

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions,
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue(positions as any)
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(7_000_000_000))

      // Mock token balances
      vi.mocked(mockTokenBalanceService.getTokenBalance)
        .mockResolvedValueOnce({
          mint: 'Token1',
          amount: BigInt(1000),
          decimals: 9,
        })
        .mockResolvedValueOnce({
          mint: 'Token2',
          amount: BigInt(2000),
          decimals: 9,
        })

      // Mock token info
      vi.mocked(mockJupiterService.getTokenInfo)
        .mockResolvedValueOnce({
          address: 'Token1',
          symbol: 'T1',
          name: 'Token 1',
          decimals: 9,
        })
        .mockResolvedValueOnce({
          address: 'Token2',
          symbol: 'T2',
          name: 'Token 2',
          decimals: 9,
        })

      // Mock quotes
      vi.mocked(mockJupiterService.getQuote)
        .mockResolvedValueOnce({
          inAmount: '1000',
          outAmount: '1500000000', // 1.5 SOL
          priceImpactPct: 0.1,
        } as any)
        .mockResolvedValueOnce({
          inAmount: '2000',
          outAmount: '2500000000', // 2.5 SOL
          priceImpactPct: 0.1,
        } as any)

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.currentValue).toBe(BigInt(11_000_000_000)) // 7 SOL + 1.5 SOL + 2.5 SOL
      expect(result.pnlAmount).toBe(BigInt(1_000_000_000)) // 1 SOL profit
      expect(result.pnlPercent).toBe(10) // 10% gain
      expect(result.tokenPositions).toHaveLength(2)
    })

    it('handles errors gracefully when getting token quote fails', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(5_000_000_000),
      })

      const positions = [
        {
          id: 'pos-1',
          groupId: 'group-1',
          tokenAddress: 'Token123',
          balance: BigInt(1000),
          costBasis: BigInt(1_000_000_000),
        },
      ]

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions,
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue(positions as any)
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(4_000_000_000))

      vi.mocked(mockTokenBalanceService.getTokenBalance).mockResolvedValue({
        mint: 'Token123',
        amount: BigInt(1000),
        decimals: 9,
      })

      vi.mocked(mockJupiterService.getTokenInfo).mockResolvedValue({
        address: 'Token123',
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 9,
      })

      // Mock quote failure - throw error instead of returning null
      vi.mocked(mockJupiterService.getQuote).mockRejectedValue(new Error('Quote failed'))

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      // Should still return valid result with just SOL
      expect(result.currentValue).toBe(BigInt(4_000_000_000))
      expect(result.tokenPositions).toHaveLength(0)
    })

    it('throws error when group not found', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)

      await expect(
        groupService.calculateGroupPnL(
          'non-existent',
          mockJupiterService,
          mockTokenBalanceService,
        ),
      ).rejects.toThrow('Group non-existent not found')
    })

    it('calculates zero PnL when current value equals deposits', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(5_000_000_000),
      })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions: [],
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue([])
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(5_000_000_000))

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.pnlAmount).toBe(BigInt(0))
      expect(result.pnlPercent).toBe(0)
    })

    it('handles zero deposits correctly', async () => {
      const group = createMockGroup({
        id: 'group-1',
        totalDeposits: BigInt(0),
      })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        ...group,
        positions: [],
      } as any)
      vi.mocked(mockPrisma.position.findMany).mockResolvedValue([])
      vi.mocked(mockWalletService.getBalance).mockResolvedValue(BigInt(1_000_000_000))

      const result = await groupService.calculateGroupPnL(
        'group-1',
        mockJupiterService,
        mockTokenBalanceService,
      )

      expect(result.totalDeposits).toBe(BigInt(0))
      expect(result.pnlPercent).toBe(0) // Should be 0 when deposits are 0
    })
  })

  describe('getMembershipsWithDeposits', () => {
    beforeEach(() => {
      ;(mockPrisma as any).member = {
        findMany: vi.fn(),
      }
    })

    it('returns only memberships with deposits > 0', async () => {
      const group1 = createMockGroup({ id: 'group-1', telegramGroupId: '-1001234567890' })
      const group2 = createMockGroup({ id: 'group-2', telegramGroupId: '-1001234567891' })
      const member1 = createMockMember({
        id: 'member-1',
        groupId: 'group-1',
        deposits: BigInt(1000000000), // 1 SOL
      })
      const member2 = createMockMember({
        id: 'member-2',
        groupId: 'group-2',
        deposits: BigInt(2000000000), // 2 SOL
      })

      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([
        { ...member1, group: group1 },
        { ...member2, group: group2 },
      ] as any)

      const result = await groupService.getMembershipsWithDeposits('123456789')

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith({
        where: {
          telegramUserId: '123456789',
          deposits: { gt: 0 },
        },
        include: { group: true },
      })
      expect(result).toHaveLength(2)
      expect(result[0].deposits).toBe(BigInt(1000000000))
      expect(result[1].deposits).toBe(BigInt(2000000000))
    })

    it('returns empty array when user has no deposits', async () => {
      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([])

      const result = await groupService.getMembershipsWithDeposits('123456789')

      expect(result).toEqual([])
    })

    it('excludes memberships with zero deposits', async () => {
      const group1 = createMockGroup({ id: 'group-1' })
      const member1 = createMockMember({
        id: 'member-1',
        groupId: 'group-1',
        deposits: BigInt(1000000000), // 1 SOL
      })

      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([
        { ...member1, group: group1 },
      ] as any)

      const result = await groupService.getMembershipsWithDeposits('123456789')

      expect(mockPrisma.member.findMany).toHaveBeenCalledWith({
        where: {
          telegramUserId: '123456789',
          deposits: { gt: 0 },
        },
        include: { group: true },
      })
      expect(result).toHaveLength(1)
    })
  })
})
