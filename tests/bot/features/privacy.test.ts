import type { PrismaClient } from '@prisma/client'
import { privacyFeature } from '#root/bot/features/privacy.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext } from '../../utils/mocks/context.js'

describe('privacyFeature', () => {
  let mockPrisma: PrismaClient

  beforeEach(() => {
    mockPrisma = {
      group: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    } as any
  })

  describe('privacy command', () => {
    it('shows current privacy status when no argument provided', async () => {
      const ctx = createMockContext({
        chatType: 'group',
        command: 'privacy',
      })

      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: ctx.from?.id } },
      ])
      ctx.reply = vi.fn()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        id: 'group-1',
        telegramGroupId: '123',
        isPublicLeaderboard: true,
      } as any)

      await privacyFeature(mockPrisma).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Privacy Settings'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      )
    })

    it('updates privacy to public', async () => {
      const ctx = createMockContext({
        chatType: 'group',
        command: 'privacy',
        messageText: '/privacy public',
      })
      ;(ctx.message as any).text = '/privacy public'

      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: ctx.from?.id } },
      ])
      ctx.reply = vi.fn()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        id: 'group-1',
        telegramGroupId: '123',
        isPublicLeaderboard: false,
      } as any)

      vi.mocked(mockPrisma.group.update).mockResolvedValue({
        id: 'group-1',
        telegramGroupId: '123',
        isPublicLeaderboard: true,
      } as any)

      await privacyFeature(mockPrisma).middleware()(ctx, vi.fn())

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPublicLeaderboard: true },
      })

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Privacy Setting Updated'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      )
    })

    it('updates privacy to private', async () => {
      const ctx = createMockContext({
        chatType: 'group',
        command: 'privacy',
        messageText: '/privacy private',
      })
      ;(ctx.message as any).text = '/privacy private'

      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: ctx.from?.id } },
      ])
      ctx.reply = vi.fn()

      vi.mocked(mockPrisma.group.findUnique).mockResolvedValue({
        id: 'group-1',
        telegramGroupId: '123',
        isPublicLeaderboard: true,
      } as any)

      vi.mocked(mockPrisma.group.update).mockResolvedValue({
        id: 'group-1',
        telegramGroupId: '123',
        isPublicLeaderboard: false,
      } as any)

      await privacyFeature(mockPrisma).middleware()(ctx, vi.fn())

      expect(mockPrisma.group.update).toHaveBeenCalledWith({
        where: { id: 'group-1' },
        data: { isPublicLeaderboard: false },
      })
    })

    it('rejects non-admin users', async () => {
      const ctx = createMockContext({
        chatType: 'group',
        command: 'privacy',
      })

      ctx.getChatAdministrators = vi.fn().mockResolvedValue([
        { user: { id: 999999 } }, // Different user
      ])
      ctx.reply = vi.fn()

      await privacyFeature(mockPrisma).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Only group administrators'),
      )
      expect(mockPrisma.group.findUnique).not.toHaveBeenCalled()
    })

    it('rejects in private chat', async () => {
      const ctx = createMockContext({
        chatType: 'private',
        command: 'privacy',
      })

      ctx.reply = vi.fn()

      await privacyFeature(mockPrisma).middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('only available in group chats'),
      )
    })
  })
})
