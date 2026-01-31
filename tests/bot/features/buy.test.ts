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
  trade: {
    aggregate: vi.fn(),
  },
} as any

const mockJupiterService = {
  COMMON_TOKENS: {
    SOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  },
  resolveTokenAddress: vi.fn(),
  getTokenInfo: vi.fn(),
  getTokenRiskInfo: vi.fn(),
  getQuote: vi.fn(),
  calculatePriceImpact: vi.fn(),
  isPriceImpactAcceptable: vi.fn(),
  formatTokenAmount: vi.fn(),
} as any

const mockWalletService = {
  getBalance: vi.fn(),
} as any

const mockTokenBalanceService = {} as any

// Mock fetch globally
globalThis.fetch = vi.fn()

describe('buy command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reject /buy command in private chat', async () => {
    const ctx = createMockGroupContext({ chatType: 'private', command: 'buy' })
    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith('The /buy command is only available in group chats.')
  })

  it('should show usage when no arguments provided', async () => {
    const ctx = createMockGroupContext({ command: 'buy' })
    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage:'),
      expect.objectContaining({
        reply_parameters: { message_id: ctx.msg!.message_id },
      }),
    )
  })

  it('should show warning for unverified token', async () => {
    const unverifiedToken = 'UnverifiedToken123'
    const ctx = createMockGroupContext({ command: `buy ${unverifiedToken} 100` })
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      isPaused: false,
      walletAddress: 'wallet-address',
      members: [{ telegramUserId: 'user-1', isTrader: true }],
    })

    mockJupiterService.resolveTokenAddress.mockReturnValue(unverifiedToken)
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'UNK',
      name: 'Unknown Token',
      decimals: 9,
    })
    mockJupiterService.getTokenRiskInfo.mockResolvedValue({
      isVerified: false,
      isTradable: true,
      hasFreezeAuthority: true,
      mintAuthorityRevoked: false,
      riskLevel: 'tradable',
    })

    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('RISK WARNING'),
      expect.objectContaining({
        parse_mode: 'HTML',
      }),
    )
  })

  it('should proceed with trade for verified token without warning', async () => {
    const verifiedToken = mockJupiterService.COMMON_TOKENS.USDC
    const ctx = createMockGroupContext({ command: 'buy USDC 1' })
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      isPaused: false,
      walletAddress: 'wallet-address',
      members: [{ telegramUserId: 'user-1', isTrader: true }],
    })

    mockJupiterService.resolveTokenAddress.mockReturnValue(verifiedToken)
    mockJupiterService.getTokenInfo.mockResolvedValue({
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    })
    mockJupiterService.getQuote.mockResolvedValue({
      inAmount: '1000000000',
      outAmount: '1000000',
      priceImpactPct: '0.1',
    })
    mockJupiterService.calculatePriceImpact.mockReturnValue(0.1)
    mockJupiterService.isPriceImpactAcceptable.mockReturnValue(true)
    mockJupiterService.formatTokenAmount.mockReturnValue('1.0')
    mockWalletService.getBalance.mockResolvedValue(BigInt(2000000000)) // 2 SOL
    mockPrisma.trade.aggregate.mockResolvedValue({ _sum: { amountIn: null } })

    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    // Should not show warning, should show confirmation directly
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Confirm Buy Order'),
      expect.objectContaining({
        parse_mode: 'HTML',
      }),
    )
    expect(ctx.reply).not.toHaveBeenCalledWith(
      expect.stringContaining('RISK WARNING'),
    )
  })

  it('should handle risk acknowledgment callback', async () => {
    // Note: This test is simplified since the risk ack now requires a stored pendingRiskAck
    // In real usage, the /buy command stores the pending risk ack, then the callback retrieves it
    // For this test, we just verify the callback pattern is correct
    const riskAckId = '-1001234567890:123:1234567890'
    const ctx = createMockGroupContext({})
    // Mock callback query
    ctx.callbackQuery = {
      id: 'callback-1',
      from: { id: 123, is_bot: false, first_name: 'Test' },
      chat_instance: 'instance-1',
      data: `risk:ack:${riskAckId}`,
      message: {
        message_id: 1,
        date: Date.now() / 1000,
        chat: ctx.chat,
        text: 'Warning message',
      },
    } as any
    // Match the regex pattern: /^risk:ack:(.+)$/
    ctx.match = [`risk:ack:${riskAckId}`, riskAckId]

    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    // Since there's no pending risk ack stored, it should show expired
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: '❌ This request has expired',
    })
  })

  it('should reject invalid token address', async () => {
    const ctx = createMockGroupContext({ command: 'buy invalid_token 100' })
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'group-1',
      isPaused: false,
      walletAddress: 'wallet-address',
      members: [{ telegramUserId: 'user-1', isTrader: true }],
    })

    mockJupiterService.resolveTokenAddress.mockImplementation(() => {
      throw new Error('Invalid token address')
    })

    const feature = tradeFeature(
      mockPrisma,
      mockWalletService,
      mockJupiterService,
      'https://api.mainnet-beta.solana.com',
      mockTokenBalanceService,
    )

    await feature.middleware()(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid token'),
    )
  })
})
