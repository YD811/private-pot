import { tradeFeature } from '#root/bot/features/trade.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockGroupContext } from '../../utils/mocks/context.js'

// Mock dependencies
const mockPrisma = {
  group: {
    findUnique: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
  position: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  trade: {
    create: vi.fn(),
  },
} as any

const mockJupiterService = {
  resolveTokenAddress: vi.fn(),
  getTokenInfo: vi.fn(),
  getQuote: vi.fn(),
  executeSwap: vi.fn(),
  formatTokenAmount: vi.fn(),
  calculatePriceImpact: vi.fn((quote: any) => {
    if (!quote?.priceImpactPct)
      return 0
    return Number.parseFloat(quote.priceImpactPct)
  }),
} as any

const mockWalletService = {
  createGroupWallet: vi.fn().mockReturnValue({ publicKey: 'test-wallet-address' }),
  getBalance: vi.fn(),
} as any

const mockTokenBalanceService = {
  getTokenBalance: vi.fn(),
} as any

describe('sell command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject /sell command in private chat', async () => {
    const ctx = createMockGroupContext({ chatType: 'private', command: 'sell' })
    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith('The /sell command is only available in group chats.')
  })

  it('should show usage when no arguments provided', async () => {
    const ctx = createMockGroupContext({ command: 'sell' })
    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should show usage when only one argument provided', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK' })
    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject when group is not initialized', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue(null)

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('not been initialized'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject when user is not a member', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
    mockPrisma.member.findUnique.mockResolvedValue(null)

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('not a member'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject when user is not a trader', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1' })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: false,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('trading permission'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject when group is paused', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: true })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Trading is currently paused'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject invalid token symbol', async () => {
    const ctx = createMockGroupContext({ command: 'sell INVALID 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockImplementation(() => {
      throw new Error('Invalid token')
    })
    mockPrisma.position.findMany.mockResolvedValue([])

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Unknown token'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should find token by symbol from positions when resolveTokenAddress fails', async () => {
    const ctx = createMockGroupContext({ command: 'sell TIKTOK all' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false, walletAddress: 'wallet123' })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    // resolveTokenAddress throws for unknown token
    mockJupiterService.resolveTokenAddress.mockImplementation(() => {
      throw new Error('Invalid token')
    })
    // But we have a position with this token
    mockPrisma.position.findMany.mockResolvedValue([
      {
        id: 'position-1',
        tokenAddress: 'DL6BBBQ6heTg9Zr5gFZxsCK2AZt2aVyRqUZgChqopump',
        balance: BigInt(1000000),
      },
    ])
    // getTokenInfo returns the symbol we're searching for
    mockJupiterService.getTokenInfo
      .mockResolvedValueOnce({
        symbol: 'TIKTOK',
        name: 'Tiktok Coin',
        decimals: 6,
      })
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000),
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'DL6BBBQ6heTg9Zr5gFZxsCK2AZt2aVyRqUZgChqopump',
      amount: BigInt(1000000),
      decimals: 6,
    })
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'TIKTOK',
      name: 'Tiktok Coin',
      decimals: 6,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    // Should proceed with the sell (we'll check that it doesn't error about unknown token)
    expect(ctx.reply).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown token'),
      expect.anything(),
    )
  })

  it('should reject when user has no position for token', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 1000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue(null)
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(0),
      decimals: 5,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('no position'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject when user has insufficient balance', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 2000000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000), // 1M BONK
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(1000000), // 1M BONK
      decimals: 5,
    })
    mockJupiterService.formatTokenAmount.mockReturnValue('1.0000')

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Insufficient balance'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should handle "all" keyword correctly', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK all' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000), // 1M BONK
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(1000000), // 1M BONK
      decimals: 5,
    })
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'BONK',
      decimals: 5,
    })
    mockJupiterService.getQuote.mockResolvedValue({
      inAmount: '1000000',
      outAmount: '1000000000', // 1 SOL
    })
    mockJupiterService.formatTokenAmount.mockReturnValue('1.0000')

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Sell 1.0000 BONK'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should handle percentage correctly', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 50%' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000), // 1M BONK
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(1000000), // 1M BONK
      decimals: 5,
    })
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'BONK',
      decimals: 5,
    })
    mockJupiterService.getQuote.mockResolvedValue({
      inAmount: '500000', // 50% of 1M
      outAmount: '500000000', // 0.5 SOL
    })
    mockJupiterService.formatTokenAmount.mockReturnValue('0.5000')

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Sell 0.5000 BONK'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should handle numeric amount correctly', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 500000' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(100000000000), // 1M BONK with 5 decimals
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(100000000000), // 1M BONK with 5 decimals
      decimals: 5,
    })
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'BONK',
      decimals: 5,
    })
    mockJupiterService.getQuote.mockResolvedValue({
      inAmount: '500000',
      outAmount: '500000000', // 0.5 SOL
    })
    mockJupiterService.formatTokenAmount.mockReturnValue('0.5000')

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Sell 0.5000 BONK'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject invalid percentage', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK 150%' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000), // 1M BONK
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(1000000), // 1M BONK
      decimals: 5,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid percentage'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should reject invalid amount', async () => {
    const ctx = createMockGroupContext({ command: 'sell BONK abc' })
    mockPrisma.group.findUnique.mockResolvedValue({ id: 'group-1', isPaused: false })
    mockPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      isTrader: true,
    })
    mockJupiterService.resolveTokenAddress.mockReturnValue('BONK_ADDRESS')
    mockPrisma.position.findUnique.mockResolvedValue({
      id: 'position-1',
      balance: BigInt(1000000), // 1M BONK
    })
    mockTokenBalanceService.getTokenBalance.mockResolvedValue({
      mint: 'BONK_ADDRESS',
      amount: BigInt(1000000), // 1M BONK
      decimals: 5,
    })

    const feature = tradeFeature(mockPrisma, mockWalletService, mockJupiterService, 'https://api.mainnet-beta.solana.com', mockTokenBalanceService)
    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid amount'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })
})
