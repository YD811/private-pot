import { membersFeature } from '#root/bot/features/members.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockGroupContext } from '../../utils/mocks/context.js'

// Mock Prisma
const mockPrisma = {
  group: {
    findUnique: vi.fn(),
  },
  member: {
    findMany: vi.fn(),
  },
}

vi.mock('#root/db.js', () => ({
  prisma: mockPrisma,
}))

describe('membersFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('/members command', () => {
    it('should fail in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'members' })

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('The /members command is only available in group chats.')
    })

    it('should fail when group not initialized', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      mockPrisma.group.findUnique.mockResolvedValue(null)

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    })

    it('should show message when group has no members', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      const group = {
        id: 'group-1',
        totalDeposits: BigInt(0),
      }
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.member.findMany.mockResolvedValue([])

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `👥 <b>Group Members</b>

No members have made deposits yet.

Use /deposit to join the group!`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show single member with ownership', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      const group = {
        id: 'group-1',
        totalDeposits: BigInt(2000000000), // 2 SOL
      }
      const members = [
        {
          id: 'member-1',
          telegramUsername: 'alice',
          deposits: BigInt(2000000000), // 2 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.member.findMany.mockResolvedValue(members)

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `👥 <b>Group Members</b>

<b>1.</b> @alice
   💰 2.0000 SOL (100.00%)

<b>Total:</b> 2.0000 SOL`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show multiple members sorted by deposits', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      const group = {
        id: 'group-1',
        totalDeposits: BigInt(5000000000), // 5 SOL
      }
      const members = [
        {
          id: 'member-1',
          telegramUsername: 'alice',
          deposits: BigInt(3000000000), // 3 SOL
        },
        {
          id: 'member-2',
          telegramUsername: 'bob',
          deposits: BigInt(2000000000), // 2 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.member.findMany.mockResolvedValue(members)

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `👥 <b>Group Members</b>

<b>1.</b> @alice
   💰 3.0000 SOL (60.00%)

<b>2.</b> @bob
   💰 2.0000 SOL (40.00%)

<b>Total:</b> 5.0000 SOL`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle members without username', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      const group = {
        id: 'group-1',
        totalDeposits: BigInt(1000000000), // 1 SOL
      }
      const members = [
        {
          id: 'member-1',
          telegramUsername: null,
          deposits: BigInt(1000000000), // 1 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.member.findMany.mockResolvedValue(members)

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `👥 <b>Group Members</b>

<b>1.</b> User
   💰 1.0000 SOL (100.00%)

<b>Total:</b> 1.0000 SOL`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle zero total deposits', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      const group = {
        id: 'group-1',
        totalDeposits: BigInt(0),
      }
      const members = [
        {
          id: 'member-1',
          telegramUsername: 'alice',
          deposits: BigInt(0),
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.member.findMany.mockResolvedValue(members)

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `👥 <b>Group Members</b>

<b>1.</b> @alice
   💰 0.0000 SOL (0.00%)

<b>Total:</b> 0.0000 SOL`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle database errors gracefully', async () => {
      const ctx = createMockGroupContext({ command: 'members' })
      ctx.logger = { error: vi.fn() } as any
      mockPrisma.group.findUnique.mockRejectedValue(new Error('Database error'))

      const composer = membersFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('❌ Failed to get members list. Please try again.')
    })
  })
})
