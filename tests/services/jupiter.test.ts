import { JupiterService } from '#root/services/jupiter.js'
import { createJupiterApiClient } from '@jup-ag/api'
import { PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('@jup-ag/api')
vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}))

// Mock fetch globally
globalThis.fetch = vi.fn()

describe('jupiterService', () => {
  let jupiterService: JupiterService
  let mockJupiterApi: any

  beforeEach(() => {
    mockJupiterApi = {
      quoteGet: vi.fn(),
      swapPost: vi.fn(),
    }

    vi.mocked(createJupiterApiClient).mockReturnValue(mockJupiterApi)

    jupiterService = new JupiterService('https://api.mainnet-beta.solana.com', {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    } as any)
  })

  describe('resolveTokenAddress', () => {
    it('should resolve SOL to native mint', () => {
      const result = jupiterService.resolveTokenAddress('SOL')
      expect(result).toBe('So11111111111111111111111111111111111111112')
    })

    it('should resolve USDC to correct address', () => {
      const result = jupiterService.resolveTokenAddress('USDC')
      expect(result).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    })

    it('should return the input if already a valid address', () => {
      const address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const result = jupiterService.resolveTokenAddress(address)
      expect(result).toBe(address)
    })
  })

  describe('getQuote', () => {
    it('should fetch a quote successfully', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '150000000',
        priceImpactPct: 0.1,
      }

      mockJupiterApi.quoteGet.mockResolvedValue(mockQuote)

      // Use resolved mint addresses instead of symbols
      const result = await jupiterService.getQuote(
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        1000000000,
      )

      expect(mockJupiterApi.quoteGet).toHaveBeenCalledWith({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1000000000,
        slippageBps: 50,
        onlyDirectRoutes: false,
      })
      expect(result).toEqual(mockQuote)
    })

    it('should throw error when quote fetch fails', async () => {
      mockJupiterApi.quoteGet.mockRejectedValue(new Error('API error'))

      await expect(
        jupiterService.getQuote(
          'So11111111111111111111111111111111111111112',
          'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          1000000000,
        ),
      ).rejects.toThrow('API error')
    })
  })

  describe('executeSwap', () => {
    it('should execute swap successfully', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '150000000',
      }

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
      }

      mockJupiterApi.swapPost.mockResolvedValue(mockSwapResponse)

      const userPubKey = new PublicKey('11111111111111111111111111111111')
      const result = await jupiterService.executeSwap(mockQuote as any, userPubKey)

      expect(mockJupiterApi.swapPost).toHaveBeenCalledWith({
        swapRequest: {
          userPublicKey: userPubKey.toBase58(),
          quoteResponse: mockQuote,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: true,
        },
      })
      expect(result).toBe('base64-encoded-transaction')
    })

    it('should throw error when swap transaction is missing', async () => {
      const mockQuote = {
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inAmount: '1000000000',
        outAmount: '150000000',
      }

      mockJupiterApi.swapPost.mockResolvedValue({})

      const userPubKey = new PublicKey('11111111111111111111111111111111')

      await expect(
        jupiterService.executeSwap(mockQuote as any, userPubKey),
      ).rejects.toThrow('No swap transaction received from Jupiter')
    })
  })

  describe('isTokenVerified', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return true for verified token', async () => {
      const verifiedToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const mockResponse = {
        tokens: [
          { mint: verifiedToken },
          { mint: 'AnotherVerifiedToken' },
        ],
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await jupiterService.isTokenVerified(verifiedToken)
      expect(result).toBe(true)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://lite-api.jup.ag/tokens/v2/tag?query=verified',
      )
    })

    it('should return false for unverified token', async () => {
      const unverifiedToken = 'UnverifiedToken123'
      const mockResponse = {
        tokens: [
          { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
        ],
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const result = await jupiterService.isTokenVerified(unverifiedToken)
      expect(result).toBe(false)
    })

    it('should cache verified tokens', async () => {
      const verifiedToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const mockResponse = {
        tokens: [{ mint: verifiedToken }],
      }

      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      // First call should fetch
      await jupiterService.isTokenVerified(verifiedToken)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)

      // Second call should use cache
      await jupiterService.isTokenVerified(verifiedToken)
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    })

    it('should return false on API error', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('API error'))

      const result = await jupiterService.isTokenVerified('SomeToken')
      expect(result).toBe(false)
    })
  })

  describe('getTokenRiskInfo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return risk info for verified token', async () => {
      const verifiedToken = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const mockVerifiedResponse = {
        tokens: [{ mint: verifiedToken }],
      }
      const mockQuote = {
        inAmount: '1000000',
        outAmount: '150000000',
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVerifiedResponse,
      } as Response)

      mockJupiterApi.quoteGet.mockResolvedValue(mockQuote)

      const riskInfo = await jupiterService.getTokenRiskInfo(verifiedToken)

      expect(riskInfo.isVerified).toBe(true)
      expect(riskInfo.isTradable).toBe(true)
      expect(riskInfo.riskLevel).toBe('verified')
    })

    it('should return risk info for unverified but tradable token', async () => {
      const unverifiedToken = 'UnverifiedToken123'
      const mockVerifiedResponse = {
        tokens: [],
      }
      const mockQuote = {
        inAmount: '1000000',
        outAmount: '150000000',
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVerifiedResponse,
      } as Response)

      mockJupiterApi.quoteGet.mockResolvedValue(mockQuote)

      const riskInfo = await jupiterService.getTokenRiskInfo(unverifiedToken)

      expect(riskInfo.isVerified).toBe(false)
      expect(riskInfo.isTradable).toBe(true)
      expect(riskInfo.riskLevel).toBe('tradable')
    })

    it('should return unknown risk for non-tradable token', async () => {
      const nonTradableToken = 'NonTradableToken123'
      const mockVerifiedResponse = {
        tokens: [],
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockVerifiedResponse,
      } as Response)

      mockJupiterApi.quoteGet.mockRejectedValue(new Error('No quote'))

      const riskInfo = await jupiterService.getTokenRiskInfo(nonTradableToken)

      expect(riskInfo.isVerified).toBe(false)
      expect(riskInfo.isTradable).toBe(false)
      expect(riskInfo.riskLevel).toBe('unknown')
    })
  })

  describe('getTokenInfo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fetch token info from Jupiter API for unknown token', async () => {
      const unknownToken = 'UnknownToken123'
      const mockTokenData = {
        symbol: 'UNK',
        name: 'Unknown Token',
        decimals: 9,
        logoURI: 'https://example.com/logo.png',
      }

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenData,
      } as Response)

      const tokenInfo = await jupiterService.getTokenInfo(unknownToken)

      expect(tokenInfo).toEqual({
        address: unknownToken,
        symbol: 'UNK',
        name: 'Unknown Token',
        decimals: 9,
        logoURI: 'https://example.com/logo.png',
      })
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://lite-api.jup.ag/tokens/v1/${unknownToken}`,
      )
    })

    it('should return fallback info when API fails', async () => {
      const unknownToken = 'UnknownToken123'

      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('API error'))

      const tokenInfo = await jupiterService.getTokenInfo(unknownToken)

      expect(tokenInfo).toEqual({
        address: unknownToken,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
        decimals: 9,
      })
    })
  })
})
