import type { GroupService } from '#root/services/group.js'
import type { PrismaClient } from '@prisma/client'
import { startFeature } from '#root/bot/features/start.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

function createMockGroup(overrides = {}) {
  return {
    id: 'group-1',
    walletAddress: 'SolWalletAddress123',
    telegramGroupId: '-1001234567890',
    ...overrides,
  }
}

function createMockMember(overrides = {}) {
  return {
    id: 'member-1',
    depositAddress: 'UserDepositAddress456',
    deposits: BigInt(1000000000), // 1 SOL
    groupId: 'group-1',
    telegramUserId: '123456789',
    ...overrides,
  }
}

describe('startFeature', () => {
  let mockPrisma: PrismaClient
  let mockGroupService: GroupService

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      member: {
        findMany: vi.fn(),
      },
    } as any

    mockGroupService = {
      getOrCreateGroup: vi.fn(),
      getOrCreateMember: vi.fn(),
      getMembershipsWithDeposits: vi.fn(),
    } as any
  })

  describe('start command in private chat', () => {
    it('shows welcome message', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'start' })
      ctx.t = vi.fn().mockReturnValue('Welcome message')
      ctx.reply = vi.fn()
      ;(ctx as any).me = { username: 'testbot' }

      // Mock the findMany call for top groups
      vi.mocked(mockPrisma.group.findMany).mockResolvedValue([])

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Welcome to Pot Bot'),
        { parse_mode: 'HTML' },
      )
    })
  })

  describe('start command in group', () => {
    it('shows existing group info when already initialized', async () => {
      const existingGroup = createMockGroup()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(existingGroup as any)

      const ctx = createMockContext({
        chatType: 'group',
        chatId: -1001234567890,
        command: 'start',
      })
      ctx.reply = vi.fn()

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('already initialized'),
      )
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('SolWalletAddress123'),
      )
    })

    it('rejects non-admin user attempting initialization', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -1001234567890,
        userId: 123456789,
        command: 'start',
      })
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 987654321 } },
      ])
      ctx.reply = vi.fn()

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
      expect(mockGroupService.getOrCreateGroup).not.toHaveBeenCalled()
    })

    it('initializes group for admin user', async () => {
      const newGroup = createMockGroup({ id: 'group-new', walletAddress: 'NewWalletAddress456' })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)
      vi.mocked(mockGroupService.getOrCreateGroup).mockResolvedValue(newGroup as any)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -1001234567890,
        userId: 123456789,
        command: 'start',
      })
      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 123456789 } },
      ])
      ctx.reply = vi.fn()

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(mockGroupService.getOrCreateGroup).toHaveBeenCalledWith('-1001234567890')
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Group Initialized Successfully!')
    })
  })

  describe('start command with deposit deep link', () => {
    it('handles /start deposit_<groupId> in private chat', async () => {
      const group = createMockGroup()
      const member = createMockMember()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(group as any)
      vi.mocked(mockGroupService.getOrCreateMember).mockResolvedValue(member as any)
      vi.mocked(mockGroupService.getMembershipsWithDeposits).mockResolvedValue([])

      // Use 'start deposit_xxx' format - grammY parses payload after command
      const ctx = createMockContext({
        chatType: 'private',
        command: 'start deposit_-1001234567890',
      })
      ctx.reply = vi.fn()
      ctx.api.getChat = vi.fn().mockResolvedValue({
        id: -1001234567890,
        type: 'supergroup',
        title: 'Test Group',
      })

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
        where: { telegramGroupId: '-1001234567890' },
      })
      expect(mockGroupService.getOrCreateMember).toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('UserDepositAddress456')
    })

    it('shows error when group not found in deep link', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)

      const ctx = createMockContext({
        chatType: 'private',
        command: 'start deposit_-1001234567890',
      })
      ctx.reply = vi.fn()

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('not found'),
      )
    })

    it('shows list of groups with deposits', async () => {
      const requestedGroup = createMockGroup({ id: 'group-1', telegramGroupId: '-1001234567890', totalDeposits: BigInt(2000000000) })
      const otherGroup = createMockGroup({ id: 'group-2', telegramGroupId: '-1001234567891', totalDeposits: BigInt(3000000000) })
      const member1 = createMockMember({ id: 'member-1', groupId: 'group-1', depositAddress: 'Addr1' })
      const member2 = createMockMember({ id: 'member-2', groupId: 'group-2', depositAddress: 'Addr2' })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(requestedGroup as any)
      vi.mocked(mockGroupService.getOrCreateMember).mockResolvedValue(member1 as any)
      vi.mocked(mockGroupService.getMembershipsWithDeposits).mockResolvedValue([
        { ...member1, group: requestedGroup },
        { ...member2, group: otherGroup },
      ] as any)

      const ctx = createMockContext({
        chatType: 'private',
        command: 'start deposit_-1001234567890',
      })
      ctx.reply = vi.fn()
      // First call is for the requested group name, then for each membership
      ctx.api.getChat = vi.fn()
        .mockResolvedValueOnce({ id: -1001234567890, type: 'supergroup', title: 'Test Group 1' })
        .mockResolvedValueOnce({ id: -1001234567890, type: 'supergroup', title: 'Test Group 1' })
        .mockResolvedValueOnce({ id: -1001234567891, type: 'supergroup', title: 'Test Group 2' })

      await startFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(mockGroupService.getMembershipsWithDeposits).toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0][0]
      expect(replyCall).toContain('Test Group 1')
      expect(replyCall).toContain('Test Group 2')
      expect(replyCall).toContain('Addr1')
      expect(replyCall).toContain('Addr2')
    })
  })
})
