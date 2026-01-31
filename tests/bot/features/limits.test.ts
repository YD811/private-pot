import { limitsFeature } from '#root/bot/features/limits.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockGroupContext } from '../../utils/mocks/context.js'

// Mock Prisma
const mockPrisma = {
  group: {
    findUnique: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
  trade: {
    aggregate: vi.fn(),
  },
}

vi.mock('#root/db.js', () => ({
  prisma: mockPrisma,
}))

describe('limitsFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('/limits command', () => {
    it('should fail in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'limits' })

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('The /limits command is only available in group chats.')
    })

    it('should fail when group not initialized', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      mockPrisma.group.findUnique.mockResolvedValue(null)

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    })

    it('should show message when user not a member', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
      mockPrisma.member.findUnique.mockResolvedValue(null)

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    })

    it('should show no limits when member has no limits set', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      const member = {
        id: 'member-1',
        tradeLimit: null,
        dailyLimit: null,
      }
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
      mockPrisma.member.findUnique.mockResolvedValue(member)

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📊 <b>Your Trade Limits</b>

<b>Per-trade limit:</b> None
<b>Daily limit:</b> None

You can trade up to any amount SOL per trade.`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show per-trade limit only', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      const member = {
        id: 'member-1',
        tradeLimit: BigInt(1000000000), // 1 SOL
        dailyLimit: null,
      }
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
      mockPrisma.member.findUnique.mockResolvedValue(member)

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📊 <b>Your Trade Limits</b>

<b>Per-trade limit:</b> 1.0000 SOL
<b>Daily limit:</b> None

You can trade up to 1.0000 SOL per trade.`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show both per-trade and daily limits with usage', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      const member = {
        id: 'member-1',
        tradeLimit: BigInt(2000000000), // 2 SOL
        dailyLimit: BigInt(5000000000), // 5 SOL
      }
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
      mockPrisma.member.findUnique.mockResolvedValue(member)

      // Mock today's trades: 1.5 SOL used
      mockPrisma.trade.aggregate.mockResolvedValue({
        _sum: { amountIn: BigInt(1500000000) }, // 1.5 SOL
      })

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📊 <b>Your Trade Limits</b>

<b>Per-trade limit:</b> 2.0000 SOL
<b>Daily limit:</b> 5.0000 SOL

<b>Today's usage:</b> 1.5000 SOL
<b>Remaining today:</b> 3.5000 SOL

You can trade up to 2.0000 SOL per trade and 3.5000 SOL more today.`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show daily limit exceeded', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      const member = {
        id: 'member-1',
        tradeLimit: BigInt(2000000000), // 2 SOL
        dailyLimit: BigInt(5000000000), // 5 SOL
      }
      mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
      mockPrisma.member.findUnique.mockResolvedValue(member)

      // Mock today's trades: 5 SOL used (at limit)
      mockPrisma.trade.aggregate.mockResolvedValue({
        _sum: { amountIn: BigInt(5000000000) }, // 5 SOL
      })

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📊 <b>Your Trade Limits</b>

<b>Per-trade limit:</b> 2.0000 SOL
<b>Daily limit:</b> 5.0000 SOL

<b>Today's usage:</b> 5.0000 SOL
<b>Remaining today:</b> 0.0000 SOL

You can trade up to 2.0000 SOL per trade, but you've reached your daily limit.`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle database errors gracefully', async () => {
      const ctx = createMockGroupContext({ command: 'limits' })
      ctx.logger = { error: vi.fn() } as any
      mockPrisma.group.findUnique.mockRejectedValue(new Error('Database error'))

      const composer = limitsFeature(mockPrisma as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('❌ Failed to get trade limits. Please try again.')
    })
  })
})
