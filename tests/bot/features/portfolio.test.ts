import { portfolioFeature } from '#root/bot/features/portfolio.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockContext, createMockGroupContext } from '../../utils/mocks/context.js'

// Mock Prisma
const mockPrisma = {
  group: {
    findUnique: vi.fn(),
  },
  position: {
    findMany: vi.fn(),
  },
}

// Mock Jupiter service
const mockJupiterService = {
  getTokenInfo: vi.fn(),
  getTokenPriceInUSD: vi.fn(),
}

// Mock Wallet service
const mockWalletService = {
  getBalance: vi.fn(),
}

// Mock Token Balance service
const mockTokenBalanceService = {
  getTokenBalance: vi.fn(),
  getAllTokenBalances: vi.fn(),
}

vi.mock('#root/db.js', () => ({
  prisma: mockPrisma,
}))

describe('portfolioFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('/portfolio command', () => {
    it('should fail in private chat', async () => {
      const ctx = createMockContext({ chatType: 'private', command: 'portfolio' })

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('The /portfolio command is only available in group chats.')
    })

    it('should fail when group not initialized', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      mockPrisma.group.findUnique.mockResolvedValue(null)

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith(
        'This group has not been initialized yet. An admin needs to send /start first.',
      )
    })

    it('should show message when group has no positions', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      const group = {
        id: 'group-1',
        walletAddress: 'wallet123',
      }
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.position.findMany.mockResolvedValue([])
      mockWalletService.getBalance.mockResolvedValue(BigInt(0))
      mockTokenBalanceService.getAllTokenBalances.mockResolvedValue([]) // No tokens
      mockJupiterService.getTokenPriceInUSD.mockResolvedValue(null) // No SOL price

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `💼 <b>Group Portfolio</b>

<b>SOL Balance:</b> 0.0000 SOL

No token positions yet.

Use /buy to start building your portfolio!`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show single position with cost basis', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      const group = {
        id: 'group-1',
        walletAddress: 'wallet123',
      }
      const tokenAddress = 'BonkTokenAddress123'
      const positions = [
        {
          id: 'pos-1',
          tokenAddress,
          balance: BigInt(1000000000000), // 1000 tokens
          costBasis: BigInt(2000000000), // 2 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.position.findMany.mockResolvedValue(positions)
      mockWalletService.getBalance.mockResolvedValue(BigInt(5000000000)) // 5 SOL
      // Mock getAllTokenBalances - returns all tokens in one call
      mockTokenBalanceService.getAllTokenBalances.mockResolvedValue([
        { mint: tokenAddress, amount: BigInt(1000000000000), decimals: 9 }, // 1000 BONK
      ])
      mockJupiterService.getTokenInfo.mockResolvedValue({
        symbol: 'BONK',
        name: 'Bonk',
        decimals: 9,
      })
      // Mock prices - SOL first, then BONK
      mockJupiterService.getTokenPriceInUSD
        .mockResolvedValueOnce(100.0) // SOL price
        .mockResolvedValueOnce(100.0) // BONK price per token

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `💼 <b>Group Portfolio</b>

<b>SOL Balance:</b> 5.0000 SOL ($500.00)

<b>Token Positions:</b>
• <b>BONK:</b> 1000.000000000 tokens ($100000.00)
  Cost basis: 2.0000 SOL
  <a href="https://dexscreener.com/solana/${tokenAddress}">View on Dexscreener</a>

<b>Total Portfolio Value:</b> $100500.00`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should show multiple positions', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      const group = {
        id: 'group-1',
        walletAddress: 'wallet123',
      }
      const bonkAddress = 'BonkTokenAddress123'
      const usdcAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const positions = [
        {
          id: 'pos-1',
          tokenAddress: bonkAddress,
          balance: BigInt(1000000000000), // 1000 tokens
          costBasis: BigInt(2000000000), // 2 SOL
        },
        {
          id: 'pos-2',
          tokenAddress: usdcAddress, // USDC
          balance: BigInt(1000000000), // 1000 USDC
          costBasis: BigInt(1000000000), // 1 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.position.findMany.mockResolvedValue(positions)
      mockWalletService.getBalance.mockResolvedValue(BigInt(3000000000)) // 3 SOL
      // Mock getAllTokenBalances - returns all tokens in one call
      mockTokenBalanceService.getAllTokenBalances.mockResolvedValue([
        { mint: bonkAddress, amount: BigInt(1000000000000), decimals: 9 }, // 1000 BONK
        { mint: usdcAddress, amount: BigInt(1000000000), decimals: 6 }, // 1000 USDC
      ])
      mockJupiterService.getTokenInfo
        .mockImplementation((address: string) => {
          if (address === bonkAddress)
            return Promise.resolve({ symbol: 'BONK', name: 'Bonk', decimals: 9 })
          if (address === usdcAddress)
            return Promise.resolve({ symbol: 'USDC', name: 'USD Coin', decimals: 6 })
          return Promise.resolve(null)
        })
      // Mock prices - SOL first (in initial parallel call), then token prices in parallel
      mockJupiterService.getTokenPriceInUSD
        .mockImplementation((address: string) => {
          if (address === 'So11111111111111111111111111111111111111112')
            return Promise.resolve(100.0)
          if (address === bonkAddress)
            return Promise.resolve(0.00001)
          if (address === usdcAddress)
            return Promise.resolve(1.0)
          return Promise.resolve(null)
        })

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      // Tokens are sorted by value - USDC ($1000) comes before BONK ($0.01)
      const expectedMessage = `💼 <b>Group Portfolio</b>

<b>SOL Balance:</b> 3.0000 SOL ($300.00)

<b>Token Positions:</b>
• <b>USDC:</b> 1000.000000 tokens ($1000.00)
  Cost basis: 1.0000 SOL
  <a href="https://dexscreener.com/solana/${usdcAddress}">View on Dexscreener</a>
• <b>BONK:</b> 1000.000000000 tokens ($0.0100)
  Cost basis: 2.0000 SOL
  <a href="https://dexscreener.com/solana/${bonkAddress}">View on Dexscreener</a>

<b>Total Portfolio Value:</b> $1300.01`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle token info fetch failure', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      const group = {
        id: 'group-1',
        walletAddress: 'wallet123',
      }
      const tokenAddress = 'UnknownTokenAddress123'
      const positions = [
        {
          id: 'pos-1',
          tokenAddress,
          balance: BigInt(1000000000000), // 1000 tokens
          costBasis: BigInt(2000000000), // 2 SOL
        },
      ]
      mockPrisma.group.findUnique.mockResolvedValue(group)
      mockPrisma.position.findMany.mockResolvedValue(positions)
      mockWalletService.getBalance.mockResolvedValue(BigInt(5000000000)) // 5 SOL
      // Mock getAllTokenBalances - returns token balance
      mockTokenBalanceService.getAllTokenBalances.mockResolvedValue([
        { mint: tokenAddress, amount: BigInt(1000000000000), decimals: 9 }, // 1000 tokens
      ])
      mockJupiterService.getTokenInfo.mockResolvedValue(null) // Token info not found
      // Mock prices
      mockJupiterService.getTokenPriceInUSD
        .mockResolvedValueOnce(100.0) // SOL price
        .mockResolvedValueOnce(100.0) // Token price

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      const expectedMessage = `💼 <b>Group Portfolio</b>

<b>SOL Balance:</b> 5.0000 SOL ($500.00)

<b>Token Positions:</b>
• <b>Unknown:</b> 1000.000000000 tokens ($100000.00)
  Cost basis: 2.0000 SOL
  <a href="https://dexscreener.com/solana/${tokenAddress}">View on Dexscreener</a>

<b>Total Portfolio Value:</b> $100500.00`

      expect(ctx.reply).toHaveBeenCalledWith(expectedMessage, {
        parse_mode: 'HTML',
        reply_parameters: { message_id: ctx.msg!.message_id },
      })
    })

    it('should handle database errors gracefully', async () => {
      const ctx = createMockGroupContext({ command: 'portfolio' })
      ctx.logger = { error: vi.fn() } as any
      mockPrisma.group.findUnique.mockRejectedValue(new Error('Database error'))

      const composer = portfolioFeature(mockPrisma as any, mockJupiterService as any, mockWalletService as any, mockTokenBalanceService as any)
      await composer.middleware()(ctx, vi.fn())

      expect(ctx.reply).toHaveBeenCalledWith('❌ Failed to get portfolio. Please try again.')
    })
  })
})
