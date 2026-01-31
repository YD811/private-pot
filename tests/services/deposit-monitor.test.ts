import type { Bot } from '#root/bot/index.js'
import type { Logger } from '#root/logger.js'
import type { RPCRateLimiter } from '#root/services/rpc-rate-limiter.js'
import type { WalletService } from '#root/services/wallet.js'
import type { PrismaClient } from '@prisma/client'
import { DepositMonitorService } from '#root/services/deposit-monitor.js'
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

describe('depositMonitorService', () => {
  let mockPrisma: PrismaClient
  let mockLogger: Logger
  let mockBot: Bot
  let mockWalletService: WalletService
  let mockRateLimiter: RPCRateLimiter
  let depositMonitor: DepositMonitorService

  beforeEach(() => {
    mockPrisma = {
      member: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      deposit: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      group: {
        update: vi.fn(),
      },
    } as any

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any

    mockBot = {} as any
    mockWalletService = {} as any
    mockRateLimiter = createMockRateLimiter()

    depositMonitor = new DepositMonitorService(
      mockPrisma,
      'https://api.devnet.solana.com',
      mockLogger,
      mockRateLimiter,
    )
  })

  describe('start', () => {
    it('should start monitoring when not already running', async () => {
      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([])

      await depositMonitor.start(1000)

      expect(mockLogger.info).toHaveBeenCalledWith('Deposit monitor started')
    })

    it('should not start if already running', async () => {
      vi.mocked(mockPrisma.member.findMany).mockResolvedValue([])

      // Start first time
      await depositMonitor.start(1000)
      expect(mockLogger.info).toHaveBeenCalledWith('Deposit monitor started')

      // Try to start again
      await depositMonitor.start(1000)
      expect(mockLogger.info).toHaveBeenCalledTimes(1)
    })

    it('should set bot and wallet service', () => {
      depositMonitor.setBot(mockBot)
      depositMonitor.setWalletService(mockWalletService)

      // No direct way to test this, but it should not throw
      expect(true).toBe(true)
    })
  })

  describe('stop', () => {
    it('should stop monitoring', () => {
      depositMonitor.stop()
      expect(mockLogger.info).toHaveBeenCalledWith('Deposit monitor stopped')
    })
  })
})
