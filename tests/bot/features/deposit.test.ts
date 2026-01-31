import type { GroupService } from '#root/services/group.js'
import type { PrismaClient } from '@prisma/client'
import { depositFeature } from '#root/bot/features/deposit.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

function createMockGroup(overrides = {}) {
  return {
    id: 'group-123',
    walletAddress: 'GroupWalletAddress123',
    ...overrides,
  }
}

function createMockMember(overrides = {}) {
  return {
    id: 'member-1',
    depositAddress: 'UserDepositAddress456',
    ...overrides,
  }
}

describe('depositFeature', () => {
  let mockPrisma: PrismaClient
  let mockGroupService: GroupService

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
      },
    } as any

    mockGroupService = {
      getOrCreateMember: vi.fn(),
    } as any
  })

  describe('deposit command', () => {
    it('rejects command in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'deposit' })
      ctx.reply = vi.fn()

      await depositFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('only available in group chats'),
      )
    })

    it('shows DM button with deep link instead of deposit address', async () => {
      const group = createMockGroup({ telegramGroupId: '-1001234567890' })
      const member = createMockMember()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(group as any)
      vi.mocked(mockGroupService.getOrCreateMember).mockResolvedValue(member as any)

      const ctx = createMockContext({
        chatType: 'group',
        chatId: -1001234567890,
        userId: 123456789,
        username: 'testuser',
        command: 'deposit',
      })
      ctx.reply = vi.fn()
      ;(ctx as any).me = { username: 'testbot' }

      await depositFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(mockGroupService.getOrCreateMember).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0]
      expect(replyCall[0]).toContain('personal deposit address')
      expect(replyCall[1]).toHaveProperty('reply_markup')
      const options = replyCall[1] as { reply_markup: { inline_keyboard: Array<Array<{ text: string, url: string }>> } }
      expect(options.reply_markup).toHaveProperty('inline_keyboard')
      const button = options.reply_markup.inline_keyboard[0][0]
      expect(button.text).toContain('Click here')
      expect(button.url).toContain('t.me/testbot?start=deposit_-1001234567890')
    })

    it('shows error when group is not initialized', async () => {
      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(null)

      const ctx = createMockContext({
        chatType: 'supergroup',
        chatId: -1001234567890,
        userId: 123456789,
        command: 'deposit',
      })
      ctx.reply = vi.fn()

      await depositFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('not been initialized yet'),
      )
    })

    it('shows button even when user has no username', async () => {
      const group = createMockGroup({ telegramGroupId: '-1001234567890' })

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue(group as any)

      const ctx = createMockContext({
        chatType: 'group',
        chatId: -1001234567890,
        userId: 123456789,
        username: undefined,
        command: 'deposit',
      })
      ctx.reply = vi.fn()
      ;(ctx as any).me = { username: 'testbot' }

      await depositFeature(mockPrisma, mockGroupService).middleware()(ctx, vi.fn())

      expect(mockGroupService.getOrCreateMember).not.toHaveBeenCalled()
      expect(ctx.reply).toHaveBeenCalled()
      const replyCall = vi.mocked(ctx.reply).mock.calls[0]
      expect(replyCall[1]).toHaveProperty('reply_markup')
    })
  })
})
