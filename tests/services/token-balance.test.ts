import type { Logger } from '#root/logger.js'
import type { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import { TokenBalanceService } from '#root/services/token-balance.js'
import { Connection, PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

function createMockRateLimiter(): RPCRateLimiter {
  return {
    waitForRateLimit: vi.fn().mockResolvedValue(undefined),
    executeWithRetry: vi.fn().mockImplementation(async fn => fn()),
    shouldSkip: vi.fn().mockReturnValue(false),
    resetErrors: vi.fn(),
    getConsecutiveErrors: vi.fn().mockReturnValue(0),
  } as any
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any
}

// Mock @solana/web3.js
vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn(),
  PublicKey: vi.fn(),
}))

describe('tokenBalanceService', () => {
  let mockConnection: any
  let tokenBalanceService: TokenBalanceService
  let mockRateLimiter: RPCRateLimiter
  let mockLogger: Logger

  beforeEach(() => {
    mockConnection = {
      getParsedTokenAccountsByOwner: vi.fn(),
    }
    vi.mocked(Connection).mockImplementation(() => mockConnection)
    vi.mocked(PublicKey).mockImplementation((address: any) => ({ toBase58: () => address } as any))
    mockRateLimiter = createMockRateLimiter()
    mockLogger = createMockLogger()

    tokenBalanceService = new TokenBalanceService('https://api.mainnet-beta.solana.com', mockRateLimiter, mockLogger)
  })

  describe('getTokenBalance', () => {
    it('should return token balance for wallet with token accounts', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const expectedBalance = BigInt(1000000) // 1 USDC (6 decimals)

      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          {
            pubkey: { toBase58: () => 'tokenAccount1' },
            account: {
              data: {
                parsed: {
                  info: {
                    mint: mintAddress,
                    tokenAmount: {
                      amount: expectedBalance.toString(),
                      decimals: 6,
                    },
                  },
                },
              },
            },
          },
        ],
      })

      const result = await tokenBalanceService.getTokenBalance(walletAddress, mintAddress)

      expect(result).toEqual({
        mint: mintAddress,
        amount: expectedBalance,
        decimals: 6,
      })
      expect(mockConnection.getParsedTokenAccountsByOwner).toHaveBeenCalledWith(
        expect.any(Object),
        { mint: expect.any(Object) },
      )
    })

    it('should return zero balance for wallet with no token accounts', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [],
      })

      const result = await tokenBalanceService.getTokenBalance(walletAddress, mintAddress)

      expect(result).toEqual({
        mint: mintAddress,
        amount: BigInt(0),
        decimals: 0,
      })
    })

    it('should return zero balance for wallet with token accounts but different mint', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

      // When querying for a specific mint, RPC returns only accounts for that mint
      // Since there are no accounts for the requested mint, it returns empty
      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [],
      })

      const result = await tokenBalanceService.getTokenBalance(walletAddress, mintAddress)

      expect(result).toEqual({
        mint: mintAddress,
        amount: BigInt(0),
        decimals: 0,
      })
    })

    it('should handle multiple token accounts for same mint', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const balance1 = BigInt(500000) // 0.5 USDC
      const balance2 = BigInt(300000) // 0.3 USDC
      const expectedTotal = balance1 + balance2

      mockConnection.getParsedTokenAccountsByOwner.mockResolvedValue({
        value: [
          {
            pubkey: { toBase58: () => 'tokenAccount1' },
            account: {
              data: {
                parsed: {
                  info: {
                    mint: mintAddress,
                    tokenAmount: {
                      amount: balance1.toString(),
                      decimals: 6,
                    },
                  },
                },
              },
            },
          },
          {
            pubkey: { toBase58: () => 'tokenAccount2' },
            account: {
              data: {
                parsed: {
                  info: {
                    mint: mintAddress,
                    tokenAmount: {
                      amount: balance2.toString(),
                      decimals: 6,
                    },
                  },
                },
              },
            },
          },
        ],
      })

      const result = await tokenBalanceService.getTokenBalance(walletAddress, mintAddress)

      expect(result).toEqual({
        mint: mintAddress,
        amount: expectedTotal,
        decimals: 6,
      })
    })

    it('should throw error when RPC call fails', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mintAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

      mockConnection.getParsedTokenAccountsByOwner.mockRejectedValue(new Error('RPC Error'))

      await expect(tokenBalanceService.getTokenBalance(walletAddress, mintAddress)).rejects.toThrow(
        'RPC Error',
      )
    })
  })

  describe('getAllTokenBalances', () => {
    it('should return all token balances from SPL Token program', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mint1 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const mint2 = 'So11111111111111111111111111111111111111112'

      // First call returns SPL Token accounts, second call returns Token-2022 accounts
      mockConnection.getParsedTokenAccountsByOwner
        .mockResolvedValueOnce({
          value: [
            {
              pubkey: { toBase58: () => 'tokenAccount1' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: mint1,
                      tokenAmount: {
                        amount: '1000000',
                        decimals: 6,
                      },
                    },
                  },
                },
              },
            },
            {
              pubkey: { toBase58: () => 'tokenAccount2' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: mint2,
                      tokenAmount: {
                        amount: '2000000000',
                        decimals: 9,
                      },
                    },
                  },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          value: [], // No Token-2022 tokens
        })

      const result = await tokenBalanceService.getAllTokenBalances(walletAddress)

      expect(result).toEqual([
        {
          mint: mint1,
          amount: BigInt(1000000),
          decimals: 6,
        },
        {
          mint: mint2,
          amount: BigInt(2000000000),
          decimals: 9,
        },
      ])
      // Should query both SPL Token and Token-2022 programs
      expect(mockConnection.getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2)
    })

    it('should return Token-2022 tokens', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const token2022Mint = 'Token2022MintAddress111111111111'

      // First call returns empty SPL Token accounts, second call returns Token-2022 accounts
      mockConnection.getParsedTokenAccountsByOwner
        .mockResolvedValueOnce({
          value: [], // No SPL Token accounts
        })
        .mockResolvedValueOnce({
          value: [
            {
              pubkey: { toBase58: () => 'token2022Account1' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: token2022Mint,
                      tokenAmount: {
                        amount: '5000000000',
                        decimals: 9,
                      },
                    },
                  },
                },
              },
            },
          ],
        })

      const result = await tokenBalanceService.getAllTokenBalances(walletAddress)

      expect(result).toEqual([
        {
          mint: token2022Mint,
          amount: BigInt(5000000000),
          decimals: 9,
        },
      ])
    })

    it('should combine SPL Token and Token-2022 tokens', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const splMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const token2022Mint = 'Token2022MintAddress111111111111'

      mockConnection.getParsedTokenAccountsByOwner
        .mockResolvedValueOnce({
          value: [
            {
              pubkey: { toBase58: () => 'splTokenAccount' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: splMint,
                      tokenAmount: {
                        amount: '1000000',
                        decimals: 6,
                      },
                    },
                  },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          value: [
            {
              pubkey: { toBase58: () => 'token2022Account' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: token2022Mint,
                      tokenAmount: {
                        amount: '5000000000',
                        decimals: 9,
                      },
                    },
                  },
                },
              },
            },
          ],
        })

      const result = await tokenBalanceService.getAllTokenBalances(walletAddress)

      expect(result).toEqual([
        {
          mint: splMint,
          amount: BigInt(1000000),
          decimals: 6,
        },
        {
          mint: token2022Mint,
          amount: BigInt(5000000000),
          decimals: 9,
        },
      ])
    })

    it('should return empty array for wallet with no token accounts', async () => {
      const walletAddress = '11111111111111111111111111111111'

      mockConnection.getParsedTokenAccountsByOwner
        .mockResolvedValueOnce({ value: [] })
        .mockResolvedValueOnce({ value: [] })

      const result = await tokenBalanceService.getAllTokenBalances(walletAddress)

      expect(result).toEqual([])
    })

    it('should skip zero balance accounts', async () => {
      const walletAddress = '11111111111111111111111111111111'
      const mint1 = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      const mint2 = 'So11111111111111111111111111111111111111112'

      mockConnection.getParsedTokenAccountsByOwner
        .mockResolvedValueOnce({
          value: [
            {
              pubkey: { toBase58: () => 'tokenAccount1' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: mint1,
                      tokenAmount: {
                        amount: '1000000',
                        decimals: 6,
                      },
                    },
                  },
                },
              },
            },
            {
              pubkey: { toBase58: () => 'tokenAccount2' },
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: mint2,
                      tokenAmount: {
                        amount: '0', // Zero balance
                        decimals: 9,
                      },
                    },
                  },
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({ value: [] })

      const result = await tokenBalanceService.getAllTokenBalances(walletAddress)

      expect(result).toEqual([
        {
          mint: mint1,
          amount: BigInt(1000000),
          decimals: 6,
        },
      ])
    })
  })
})
