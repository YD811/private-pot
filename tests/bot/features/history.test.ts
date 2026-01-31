import { historyFeature } from '#root/bot/features/history.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockGroupContext } from '../../utils/mocks/context.js'

// Mock Prisma
const mockPrisma = {
  group: {
    findUnique: vi.fn(),
  },
  trade: {
    findMany: vi.fn(),
  },
}

// Mock Jupiter service
const mockJupiterService = {
  getTokenInfo: vi.fn(),
}

vi.mock('#root/db.js', () => ({
  prisma: mockPrisma,
}))

describe('historyFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('/history command', () => {
    it('should fail in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'history' })

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('The /history command is only available in group chats.')
    })

    it('should fail when group not initialized', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      mockPrisma.group.findUnique.mockResolvedValue(null)

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    })

    it('should show message when group has no trades', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      const group = {
        id: 'group-1',
      }
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.trade.findMany.mockResolvedValue([])

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📈 <b>Trade History</b>

No trades have been executed yet.

Use /buy or /sell to start trading!`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show single trade', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      const group = {
        id: 'group-1',
      }
      const trades = [
        {
          id: 'trade-1',
          transactionSignature: 'trade-1',
          tradeType: 'buy',
          tokenAddress: 'So11111111111111111111111111111111111111112', // SOL
          amountIn: BigInt(1000000000), // 1 SOL
          amountOut: BigInt(1000000000000), // 1000 tokens
          executedAt: new Date('2024-01-15T10:30:00Z'),
          trader: {
            telegramUsername: 'alice',
          },
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.trade.findMany.mockResolvedValue(trades)
      mockJupiterService.getTokenInfo.mockResolvedValue({
        symbol: 'BONK',
        name: 'Bonk',
        decimals: 9,
      })

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📈 <b>Trade History</b>

<b>1.</b> BUY BONK
   💰 1.0000 SOL → 1000.000000000 BONK
   👤 @alice
   🕐 Jan 15, 10:30 AM
   🔗 <a href="https://explorer.solana.com/tx/trade-1">View Transaction</a>`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
        link_preview_options: { is_disabled: true },
      })
    })

    it('should show multiple trades (last 10)', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      const group = {
        id: 'group-1',
      }
      const trades = [
        {
          id: 'trade-2',
          transactionSignature: 'trade-2',
          tradeType: 'sell',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          amountIn: BigInt(500000000), // 0.5 SOL worth
          amountOut: BigInt(500000000), // 0.5 SOL
          executedAt: new Date('2024-01-15T11:00:00Z'),
          trader: {
            telegramUsername: 'bob',
          },
        },
        {
          id: 'trade-1',
          transactionSignature: 'trade-1',
          tradeType: 'buy',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          amountIn: BigInt(1000000000), // 1 SOL
          amountOut: BigInt(1000000000000), // 1000 tokens
          executedAt: new Date('2024-01-15T10:30:00Z'),
          trader: {
            telegramUsername: 'alice',
          },
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.trade.findMany.mockResolvedValue(trades)
      mockJupiterService.getTokenInfo
        .mockResolvedValueOnce({ symbol: 'BONK', name: 'Bonk', decimals: 9 })
        .mockResolvedValueOnce({ symbol: 'BONK', name: 'Bonk', decimals: 9 })

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📈 <b>Trade History</b>

<b>1.</b> SELL BONK
   💰 0.500000000 BONK → 0.5000 SOL
   👤 @bob
   🕐 Jan 15, 11:00 AM
   🔗 <a href="https://explorer.solana.com/tx/trade-2">View Transaction</a>

<b>2.</b> BUY BONK
   💰 1.0000 SOL → 1000.000000000 BONK
   👤 @alice
   🕐 Jan 15, 10:30 AM
   🔗 <a href="https://explorer.solana.com/tx/trade-1">View Transaction</a>`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
        link_preview_options: { is_disabled: true },
      })
    })

    it('should handle trader without username', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      const group = {
        id: 'group-1',
      }
      const trades = [
        {
          id: 'trade-1',
          transactionSignature: 'trade-1',
          tradeType: 'buy',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          amountIn: BigInt(1000000000), // 1 SOL
          amountOut: BigInt(1000000000000), // 1000 tokens
          executedAt: new Date('2024-01-15T10:30:00Z'),
          trader: {
            telegramUsername: null,
          },
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.trade.findMany.mockResolvedValue(trades)
      mockJupiterService.getTokenInfo.mockResolvedValue({
        symbol: 'BONK',
        name: 'Bonk',
        decimals: 9,
      })

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📈 <b>Trade History</b>

<b>1.</b> BUY BONK
   💰 1.0000 SOL → 1000.000000000 BONK
   👤 User
   🕐 Jan 15, 10:30 AM
   🔗 <a href="https://explorer.solana.com/tx/trade-1">View Transaction</a>`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
        link_preview_options: { is_disabled: true },
      })
    })

    it('should use devnet explorer URL for devnet RPC', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      const group = {
        id: 'group-1',
      }
      const trades = [
        {
          id: 'trade-1',
          transactionSignature: 'trade-1',
          tradeType: 'buy',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          amountIn: BigInt(1000000000), // 1 SOL
          amountOut: BigInt(1000000000000), // 1000 tokens
          executedAt: new Date('2024-01-15T10:30:00Z'),
          trader: {
            telegramUsername: 'alice',
          },
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.trade.findMany.mockResolvedValue(trades)
      mockJupiterService.getTokenInfo.mockResolvedValue({
        symbol: 'BONK',
        name: 'Bonk',
        decimals: 9,
      })

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.devnet.solana.com')
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `📈 <b>Trade History</b>

<b>1.</b> BUY BONK
   💰 1.0000 SOL → 1000.000000000 BONK
   👤 @alice
   🕐 Jan 15, 10:30 AM
   🔗 <a href="https://explorer.solana.com/tx/trade-1?cluster=devnet">View Transaction</a>`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
        link_preview_options: { is_disabled: true },
      })
    })

    it('should handle database errors gracefully', async () => {
      const ctx = createMockGroupContext({ command: 'history' })
      ctx.logger = { error: vi.fn() } as any
      mockPrisma.group.findUnique.mockRejectedValue(new Error('Database error'))

      const composer = historyFeature(mockPrisma as any, mockJupiterService as any, 'https://api.mainnet-beta.solana.com')
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('❌ Failed to get trade history. Please try again.')
    })
  })
})
